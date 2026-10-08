/**
 * ADMIN — boîte de réception et conversation avec un utilisateur.
 * L'accès est garanti par les règles Firestore (isAdmin) ; le routeur masque
 * en plus ces écrans aux non-admins.
 */
import { h } from '../lib/dom.js';
import { state } from '../store.js';
import {
  watchMessages, sendAdminMessage, markReadByAdmin, setConversationStatus, unreadForAdmin, ms,
} from '../data/messages.js';
import { PageHeader, IconButton, Skeleton, Empty } from '../ui/layout.js';
import { Thread, Composer, scrollToEnd, shortWhen } from '../ui/chat.js';
import { icon } from '../ui/icons.js';
import { Avatar } from '../ui/avatar.js';

import { T } from '../lib/i18n.js';
// ── Boîte de réception ──────────────────────────────────────────────────

const FILTERS = [
  ['all', 'Toutes'],
  ['unread', 'Non lues'],
  ['open', 'À traiter'],
  ['done', 'Traitées'],
];
const inbox = { filter: 'all', search: '' };

const rerender = () => window.dispatchEvent(new Event('app:render'));

export function AdminInboxView() {
  const header = PageHeader({
    eyebrow: 'Admin', title: 'Messages',
    trailing: IconButton('back', 'Retour', () => { location.hash = '#/contact'; }, 'icon-btn--soft'),
  });
  const list = state.adminConversations;
  if (list === null) return [header, Skeleton(4)];

  const unread = list.filter(unreadForAdmin).length;
  const open = list.filter((c) => c.status !== 'done').length;
  const q = inbox.search.trim().toLowerCase();

  const shown = list.filter((c) => {
    if (inbox.filter === 'unread' && !unreadForAdmin(c)) return false;
    if (inbox.filter === 'open' && c.status === 'done') return false;
    if (inbox.filter === 'done' && c.status !== 'done') return false;
    if (q && !`${c.userName || ''} ${c.lastText || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const search = h('input', {
    class: 'input', id: 'adm-search', type: 'search', placeholder: 'Rechercher un nom ou un message…',
    'aria-label': 'Rechercher une conversation', autocomplete: 'off',
    oninput: (e) => { inbox.search = e.target.value; rerender(); },
  });
  search.value = inbox.search;

  return [
    header,
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, String(list.length)), h('span', { class: 'stat__label' }, 'Conversations')),
      h('div', { class: `stat${unread ? ' stat--up' : ''}` }, h('span', { class: 'stat__value' }, String(unread)), h('span', { class: 'stat__label' }, 'Non lues')),
      h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, String(open)), h('span', { class: 'stat__label' }, 'À traiter'))),
    search,
    h('div', { class: 'chips' }, FILTERS.map(([key, label]) => h('button', {
      class: `chip${inbox.filter === key ? ' chip--on' : ''}`, type: 'button',
      onclick: () => { inbox.filter = key; rerender(); },
    }, label))),
    shown.length
      ? h('nav', { class: 'card card--flush', 'aria-label': 'Conversations' }, shown.map((c) => {
        const isUnread = unreadForAdmin(c);
        return h('a', { class: `conv${isUnread ? ' conv--unread' : ''}`, href: `#/admin/conv/${encodeURIComponent(c.id)}` },
          Avatar({ uid: c.id, name: c.userName }),   // l'admin lit toutes les photos (règles)
          h('span', { class: 'conv__body' },
            h('span', { class: 'conv__top' },
              h('span', { class: 'conv__name' }, c.userName || 'Utilisateur'),
              h('span', { class: 'conv__when' }, shortWhen(c.lastAt))),
            h('span', { class: 'conv__preview' }, c.lastFrom === 'admin' ? T`Toi : ${c.lastText || ''}` : (c.lastText || ''))),
          isUnread ? h('span', { class: 'dot', 'aria-label': 'Non lu' }) : null,
          c.status === 'done' ? h('span', { class: 'tag' }, 'Traitée') : null);
      }))
      : Empty({ iconName: 'message', title: list.length ? 'Aucun résultat' : 'Aucun message', text: list.length ? 'Change le filtre ou la recherche.' : 'Les messages de tes utilisateurs arriveront ici.' }),
  ];
}

// ── Conversation ────────────────────────────────────────────────────────

let feed = null;
let messages = null;
let lastCount = 0;
const drafts = {};

function ensureFeed(uid) {
  if (feed?.uid === uid) return;
  leaveAdminConversation();
  feed = { uid, unsub: watchMessages(uid, (list) => { messages = list; rerender(); }) };
}

export function leaveAdminConversation() {
  feed?.unsub?.();
  feed = null;
  messages = null;
  lastCount = 0;
}

const adminRead = {};   // « lu » écrit une seule fois par message reçu

export function AdminConversationView(session, uid) {
  ensureFeed(uid);
  const conv = (state.adminConversations || []).find((c) => c.id === uid) || null;
  if (unreadForAdmin(conv) && adminRead[uid] !== ms(conv.lastAt)) { adminRead[uid] = ms(conv.lastAt); markReadByAdmin(uid); }

  const done = conv?.status === 'done';
  const header = PageHeader({
    eyebrow: 'Conversation',
    title: conv?.userName || 'Utilisateur',
    trailing: h('div', { class: 'row-gap' },
      h('a', { href: `#/admin/user/${encodeURIComponent(uid)}`, 'aria-label': 'Voir la fiche' }, Avatar({ uid, name: conv?.userName })),
      IconButton('back', 'Retour aux messages', () => { history.length > 1 ? history.back() : (location.hash = '#/admin/messages'); }, 'icon-btn--soft')),
  });

  if (messages === null) return [header, Skeleton(3)];
  if (messages.length !== lastCount) { scrollToEnd(lastCount > 0); lastCount = messages.length; }

  drafts[uid] = drafts[uid] || { text: '' };

  return [
    header,
    h('a', { class: 'link-btn', href: `#/admin/user/${encodeURIComponent(uid)}` }, 'Voir la fiche', icon('chevron', 16)),
    conv ? h('button', {
      class: `status-toggle${done ? ' status-toggle--done' : ''}`, type: 'button',
      onclick: () => setConversationStatus(uid, done ? 'open' : 'done'),
    }, icon(done ? 'check' : 'reset', 18), done ? 'Traitée — rouvrir' : 'Marquer comme traitée') : null,
    messages.length ? Thread(messages, 'admin') : h('p', { class: 'muted center' }, 'Aucun message pour le moment.'),
    h('div', { class: 'composer-spacer' }),
    Composer({
      id: `admin-input-${uid}`, draft: drafts[uid], placeholder: 'Répondre…',
      onSend: (text) => sendAdminMessage(uid, text, conv?.userName),
    }),
  ];
}
