/**
 * ADMIN — gestion des liens utiles affichés dans Moi :
 * ajouter, modifier (ex. nouvelle chaîne TikTok), réordonner, supprimer,
 * et choisir « visible seulement par moi ».
 */
import { h } from '../lib/dom.js';
import { linksOf, saveLinks, cleanLink, LINK_ICONS } from '../data/links.js';
import { PageHeader, IconButton, Empty } from '../ui/layout.js';
import { formSheet, confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';

import { T } from '../lib/i18n.js';
const ICON_LABEL = { link: 'Lien', play: 'Vidéo', message: 'Discussion', music: 'Musique', leaf: 'Nutrition', pill: 'Compléments', dumbbell: 'Sport', heart: 'Favori' };

async function persist(next, msg) {
  try { await saveLinks(next); if (msg) toast(msg); } catch (err) {
    toast(err.code === 'permission-denied'
      ? 'Refusé par les règles Firebase : elles ne sont pas encore déployées (firebase deploy).'
      : T`Enregistrement impossible : ${err.code || err.message}`, { type: 'error', duration: 6000 });
  }
}

async function editLink(items, link) {
  const r = await formSheet({
    title: link ? 'Modifier le lien' : 'Nouveau lien',
    fields: [
      { name: 'label', label: 'Nom', value: link?.label, required: true, maxlength: 60, placeholder: 'Ma chaîne TikTok' },
      { name: 'sub', label: 'Sous-titre', value: link?.sub, maxlength: 80, placeholder: '@moncompte' },
      { name: 'href', type: 'url', label: 'Adresse (https://…)', value: link?.href, required: true, maxlength: 300, placeholder: 'https://www.tiktok.com/@…', inputmode: 'url' },
      { name: 'icon', type: 'choice', label: 'Icône', columns: 4, value: link?.icon || 'link',
        options: LINK_ICONS.map((i) => ({ value: i, label: ICON_LABEL[i] })) },
      { name: 'private', type: 'toggle', label: 'Visible seulement par moi', value: link?.private,
        hint: 'Les autres utilisateurs ne reçoivent pas ce lien.' },
    ],
    submitLabel: link ? 'Enregistrer' : 'Ajouter',
    deleteLabel: link ? 'Supprimer ce lien' : null,
  });
  if (!r) return;
  if (r.action === 'delete') {
    if (await confirmSheet({ title: T`Supprimer « ${link.label} » ?` })) persist(items.filter((x) => x.id !== link.id), 'Lien supprimé');
    return;
  }
  const next = cleanLink({ ...link, ...r.values });
  if (!next) { toast('Adresse invalide : elle doit commencer par https://', { type: 'error' }); return; }
  persist(link ? items.map((x) => (x.id === link.id ? next : x)) : [...items, next], link ? 'Lien mis à jour' : 'Lien ajouté');
}

function move(items, i, d) {
  const next = [...items];
  [next[i], next[i + d]] = [next[i + d], next[i]];
  persist(next);
}

export function AdminLinksView(session) {
  const items = linksOf(session.isAdmin);
  return [
    PageHeader({
      eyebrow: 'Admin', title: 'Liens utiles',
      trailing: IconButton('back', 'Retour', () => { location.hash = '#/admin'; }, 'icon-btn--soft'),
    }),
    items.length
      ? h('section', { class: 'card card--flush' }, items.map((l, i) => h('div', { class: 'link-edit' },
        h('button', { class: 'link-edit__main', type: 'button', onclick: () => editLink(items, l) },
          h('span', { class: 'menu-row__icon' }, icon(l.icon, 20)),
          h('span', { class: 'menu-row__label' }, l.label,
            h('span', { class: 'menu-row__sub' }, l.sub || l.href)),
          l.private ? h('span', { class: 'tag' }, icon('eyeOff', 12), 'Moi') : null),
        h('span', { class: 'link-edit__moves' },
          IconButton('up', T`Monter ${l.label}`, () => move(items, i, -1), `icon-btn--ghost${i === 0 ? ' is-hidden' : ''}`),
          IconButton('down', T`Descendre ${l.label}`, () => move(items, i, 1), `icon-btn--ghost${i === items.length - 1 ? ' is-hidden' : ''}`)))))
      : Empty({ iconName: 'link', title: 'Aucun lien', text: 'Ajoute ta chaîne, ton Discord, tes boutiques préférées…' }),
    h('button', { class: 'btn btn--primary btn--block', type: 'button', onclick: () => editLink(items, null) }, icon('plus', 18), 'Ajouter un lien'),
    h('p', { class: 'hint' }, 'Touche un lien pour le modifier (nom, adresse, icône, visibilité). Les changements apparaissent chez tout le monde à la prochaine ouverture de l’app.'),
  ];
}
