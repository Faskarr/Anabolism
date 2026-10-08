/**
 * Onglet Contact = messagerie :
 *   • le coach (utilisateur) ou les messages des utilisateurs (admin) ;
 *   • les amis : code personnel, ajout par code, discussions privées.
 */
import { h } from '../lib/dom.js';
import { localISODate } from '../lib/dates.js';
import { state, startPostsFeed, stopPostsFeed, ensureAdminUsers } from '../store.js';
import { unreadForUser, unreadForAdmin, ms, clearCoachChat } from '../data/messages.js';
import {
  ensureMyCode, addFriendByCode, removeFriend, friendOf, unreadFriend,
  watchFriendMessages, sendFriendMessage, markFriendRead,
  acceptFriend, isAccepted, isIncoming, isOutgoing,
  answerFriendShare, SHARE_LABEL, clearFriendChat, hasChat, addFriendDirect,
} from '../data/friends.js';
import { normalizeWorkout, normalizeDiet, normalizeProtocol } from '../lib/schema.js';
import { applyImport } from '../data/importer.js';
import { PageHeader, SectionTitle, IconButton, Skeleton } from '../ui/layout.js';
import { Thread, Composer, scrollToEnd, shortWhen } from '../ui/chat.js';
import { formSheet, confirmSheet, actionSheet, openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { Avatar } from '../ui/avatar.js';
import { PostRow, recentPosts, shareMusicFlow } from '../ui/feed.js';

import { T } from '../lib/i18n.js';
const rerender = () => window.dispatchEvent(new Event('app:render'));
const initial = (n) => String(n || '?').trim().charAt(0).toUpperCase() || '?';
export const trainedToday = (a) => Boolean(a && a.day === localISODate());

// ── Code ami ────────────────────────────────────────────────────────────

let myCode = null;
let codeLoading = false;
let codeFailed = false;     // échec : pas de nouvel essai automatique (évite une boucle)

function loadMyCode(session) {
  if (myCode || codeLoading || codeFailed) return;
  codeLoading = true;
  ensureMyCode(session.user, session.profile?.friendCode)
    .then((c) => { myCode = c; if (session.profile) session.profile.friendCode = c; })
    .catch((err) => { codeFailed = true; toast(err.message, { type: 'error' }); })
    .finally(() => { codeLoading = false; rerender(); });
}
function retryMyCode() { codeFailed = false; rerender(); }

async function shareCode() {
  const text = T`Ajoute-moi sur AnabolicOS avec mon code ami : ${myCode}\nhttps://anabolic-adc6a.web.app`;
  try {
    if (navigator.share) await navigator.share({ title: 'AnabolicOS', text });
    else { await navigator.clipboard?.writeText(myCode); toast('Code copié'); }
  } catch (err) { if (err?.name !== 'AbortError') toast('Partage impossible.', { type: 'error' }); }
}

/**
 * ADMIN : ajoute quelqu'un en ami directement (amitié acceptée d'office, sans
 * demande). Liste de tous les inscrits, avec recherche.
 */
function adminAddFriendFlow(session) {
  const me = session.user.uid;
  ensureAdminUsers();
  const known = new Set(state.friendships.map((f) => friendOf(f, me)));
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Rechercher un nom ou un e-mail…', 'aria-label': 'Rechercher un utilisateur', autocomplete: 'off' });
  const list = h('div', { class: 'action-list admin-pick' });
  let sheet = null;
  const draw = () => {
    const users = state.adminUsers;
    if (!users) { list.replaceChildren(h('div', { class: 'spinner', style: { margin: '16px auto' } })); setTimeout(draw, 400); return; }
    const q = search.value.trim().toLowerCase();
    const shown = users.filter((u) => u.id !== me && !known.has(u.id) && u.status !== 'disabled'
      && (!q || `${u.displayName || ''} ${u.email || ''}`.toLowerCase().includes(q))).slice(0, 40);
    list.replaceChildren(...(shown.length ? shown.map((u) => h('button', {
      class: 'action', type: 'button',
      onclick: async () => {
        const name = u.displayName || u.email || 'Utilisateur';
        if (!(await confirmSheet({ title: T`Ajouter ${name} en ami ?`, message: 'Sans demande : vous serez amis tout de suite et il te verra dans sa liste.', confirmLabel: 'Ajouter', danger: false }))) return;
        try { await addFriendDirect(session.user, { uid: u.id, name }); known.add(u.id); toast(T`${name} ajouté à tes amis`); draw(); } catch (err) {
          console.error('[admin] ami', err); toast('Ajout impossible.', { type: 'error' });
        }
      },
    }, Avatar({ uid: u.id, name: u.displayName || u.email, size: 'sm' }), h('span', {}, u.displayName || u.email, h('span', { class: 'muted small' }, T` · ${u.email || ''}`))))
      : [h('p', { class: 'muted center' }, q ? 'Aucun résultat.' : 'Tout le monde est déjà dans tes amis.')]));
  };
  search.addEventListener('input', draw);
  sheet = openSheet({ title: 'Ajouter un ami (admin)', subtitle: 'Sans demande ni code.', body: h('div', {}, search, list) });
  draw();
  return sheet;
}

async function addFriendFlow(session) {
  const r = await formSheet({
    title: 'Envoyer une demande d’ami',
    subtitle: 'Saisis son code ami : il recevra une demande à accepter.',
    fields: [{ name: 'code', label: 'Code ami', required: true, maxlength: 8, placeholder: 'ABC234', inputmode: 'text' }],
    submitLabel: 'Envoyer la demande',
  });
  if (!r?.values) return;
  try {
    const name = await addFriendByCode(session.user, r.values.code, state.friendships);
    toast(T`Demande envoyée à ${name}. Il doit l’accepter.`);
  } catch (err) {
    toast(err.code === 'permission-denied' ? 'Code invalide ou ami déjà ajouté.' : err.message, { type: 'error' });
  }
}

// ── Lignes ──────────────────────────────────────────────────────────────

function Row({ href, title, preview, when, unread, avatar, tag, onMore }) {
  const link = h('a', { class: `conv${unread ? ' conv--unread' : ''}`, href },
    avatar,
    h('span', { class: 'conv__body' },
      h('span', { class: 'conv__top' }, h('span', { class: 'conv__name' }, title), h('span', { class: 'conv__when' }, when || '')),
      h('span', { class: 'conv__preview' }, preview)),
    tag || null,
    unread ? h('span', { class: 'dot', 'aria-label': 'Non lu' }) : null);
  if (!onMore) return link;
  return h('div', { class: 'conv-wrap' }, link, IconButton('more', T`Options : ${title}`, onMore, 'icon-btn--ghost conv__more'));
}

/** Supprimer une discussion (de mon côté seulement). */
async function deleteChat(kind, session, f = null, name = '') {
  const who = kind === 'coach' ? 'avec ton coach' : T`avec ${name}`;
  const ok = await confirmSheet({
    title: T`Supprimer la discussion ${who} ?`,
    message: kind === 'coach'
      ? 'Les messages disparaissent de ton côté. Ton coach garde l’historique.'
      : T`Les messages disparaissent de ton côté. ${name} reste dans tes amis et garde la discussion.`,
    confirmLabel: 'Supprimer',
  });
  if (!ok) return false;
  try {
    if (kind === 'coach') await clearCoachChat(session.user.uid);
    else await clearFriendChat(session.user.uid, f.id);
    toast('Discussion supprimée');
    return true;
  } catch (err) {
    console.error('[chat]', err);
    toast('Suppression impossible.', { type: 'error' });
    return false;
  }
}

const coachHasChat = (c) => Boolean(c?.lastAt && ms(c.lastAt) > ms(c.userClearedAt));

function CoachRow(session) {
  if (session.isAdmin) {
    const n = (state.adminConversations || []).filter(unreadForAdmin).length;
    return Row({
      href: '#/admin/messages', title: 'Messages des utilisateurs',
      preview: n ? T`${n} conversation${n > 1 ? 's' : ''} non lue${n > 1 ? 's' : ''}` : 'Tout est lu',
      unread: n > 0, avatar: h('span', { class: 'avatar avatar--brand' }, icon('shield', 20)),
    });
  }
  const c = state.conversation;
  const live = coachHasChat(c);
  return Row({
    href: '#/contact/coach', title: 'Ton coach',
    preview: live && c?.lastText ? `${c.lastFrom === 'user' ? 'Toi : ' : ''}${c.lastText}` : 'Pose-lui une question',
    when: live ? shortWhen(c?.lastAt) : '', unread: unreadForUser(c),
    avatar: h('span', { class: 'avatar avatar--brand' }, icon('message', 20)),
    onMore: live ? () => actionSheet({ title: 'Ton coach', actions: [{ label: 'Supprimer la discussion', icon: 'trash', danger: true, onClick: () => deleteChat('coach', session) }] }) : null,
  });
}

/** Ligne de discussion avec un ami (onglet Discussions). */
function ChatRow(f, me, session) {
  const other = friendOf(f, me);
  const name = f.names?.[other] || 'Ami';
  return Row({
    href: `#/friends/${encodeURIComponent(f.id)}`,
    title: name,
    preview: f.lastText ? `${f.lastFrom === me ? 'Toi : ' : ''}${f.lastText}` : '',
    when: shortWhen(f.lastAt), unread: unreadFriend(f, me),
    avatar: Avatar({ uid: other, name }),
    onMore: () => actionSheet({ title: name, actions: [
      { label: 'Voir son profil', icon: 'user', onClick: () => { location.hash = `#/u/${encodeURIComponent(other)}`; } },
      { label: 'Supprimer la discussion', icon: 'trash', danger: true, onClick: () => deleteChat('friend', session, f, name) },
    ] }),
  });
}

/** Ligne d'ami (onglet Amis) : profil au toucher, bouton message. */
function FriendRow(f, me) {
  const other = friendOf(f, me);
  const name = f.names?.[other] || 'Ami';
  const act = state.friendActivity[other];
  return h('div', { class: 'conv-wrap' },
    h('a', { class: 'conv', href: `#/u/${encodeURIComponent(other)}` },
      Avatar({ uid: other, name }),
      h('span', { class: 'conv__body' },
        h('span', { class: 'conv__top' }, h('span', { class: 'conv__name' }, name)),
        h('span', { class: 'conv__preview' }, trainedToday(act) ? T`Entraîné aujourd’hui${act.sessionName ? T` · ${act.sessionName}` : ''}` : 'Voir son profil')),
      trainedToday(act) ? h('span', { class: 'tag tag--ok' }, icon('dumbbell', 14), 'Auj.') : null),
    h('a', { class: 'icon-btn icon-btn--soft conv__more', href: `#/friends/${encodeURIComponent(f.id)}`, 'aria-label': T`Écrire à ${name}` }, icon('message', 18)));
}

// ── Vue : hub ───────────────────────────────────────────────────────────

/** Demande reçue : Accepter / Refuser. */
function RequestRow(f, me, isAdmin) {
  const other = friendOf(f, me);
  const name = f.names?.[other] || 'Quelqu’un';
  return h('div', { class: 'request' },
    // Pas encore amis : seule l'admin peut lire la photo (règles Firestore).
    isAdmin ? Avatar({ uid: other, name }) : h('span', { class: 'avatar' }, initial(name)),
    h('span', { class: 'request__body' },
      h('span', { class: 'request__name' }, name),
      h('span', { class: 'muted small' }, 'veut t’ajouter en ami')),
    h('div', { class: 'request__actions' },
      h('button', {
        class: 'btn btn--primary btn--sm', type: 'button',
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { await acceptFriend(f.id); toast(T`${name} est maintenant ton ami`); } catch { /* erreur déjà affichée */ }
        },
      }, 'Accepter'),
      h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button',
        onclick: async () => { if (await confirmSheet({ title: T`Refuser la demande de ${name} ?`, confirmLabel: 'Refuser' })) removeFriend(f.id); },
      }, 'Refuser')));
}

/** Demande envoyée : en attente, annulable. */
function PendingRow(f, me, isAdmin) {
  const other = friendOf(f, me);
  const name = f.names?.[other] || 'Ami';
  return h('div', { class: 'request request--pending' },
    // Pas encore amis : seule l'admin peut lire la photo (règles Firestore).
    isAdmin ? Avatar({ uid: other, name }) : h('span', { class: 'avatar' }, initial(name)),
    h('span', { class: 'request__body' },
      h('span', { class: 'request__name' }, name),
      h('span', { class: 'muted small' }, 'Demande envoyée · en attente')),
    h('button', { class: 'link-btn link-btn--danger', type: 'button', onclick: () => removeFriend(f.id) }, 'Annuler'));
}

/** Quitter Contact : on arrête le fil complet (économie de lectures). */
export function leaveHub() { stopPostsFeed(); }

let hubTab = 'chats';   // onglet ouvert (gardé entre deux visites)

export function MessagesHubView(session) {
  startPostsFeed();
  loadMyCode(session);
  const me = session.user.uid;
  const friends = state.friendships.filter(isAccepted);
  const incoming = state.friendships.filter((f) => isIncoming(f, me));
  const outgoing = state.friendships.filter((f) => isOutgoing(f, me));
  const chats = friends.filter((f) => hasChat(f, me))
    .sort((a, b) => ms(b.lastAt) - ms(a.lastAt));
  const unreadChats = chats.filter((f) => unreadFriend(f, me)).length + (unreadForUser(state.conversation) ? 1 : 0);

  const tabs = h('div', { class: 'segmented segmented--fill hub-tabs', role: 'tablist' },
    [['chats', 'Social', unreadChats], ['friends', 'Amis', incoming.length]].map(([key, label, n]) => h('button', {
      class: `segment${hubTab === key ? ' segment--on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(hubTab === key),
      onclick: () => { hubTab = key; rerender(); },
    }, label, n ? h('span', { class: 'count-badge' }, String(n)) : null)));

  if (hubTab === 'chats') {
    const posts = friends.length ? recentPosts(30, 40) : [];
    return [
      PageHeader({ eyebrow: 'Messagerie', title: 'Mes messages' }),
      tabs,
      friends.length ? [
        SectionTitle('Records & sons', h('button', { class: 'link-btn', type: 'button', onclick: shareMusicFlow }, icon('music', 16), 'Partager un son')),
        posts.length
          // ~5 publications visibles, la suite en faisant défiler DANS le bloc.
          ? h('section', { class: 'card records-box' }, h('ul', { class: 'records records--scroll' }, posts.map((p) => PostRow(p, me))),
            posts.length > 5 ? h('p', { class: 'records-box__more' }, T`${posts.length} publications · fais défiler`) : null)
          : h('p', { class: 'hint' }, 'Partage ta musique du moment (Spotify, Deezer, YouTube Music) : tes amis l’ouvrent directement dans leur app.'),
      ] : null,
      SectionTitle('Discussions'),
      h('nav', { class: 'card card--flush', 'aria-label': 'Discussions' },
        CoachRow(session),
        chats.map((f) => ChatRow(f, me, session))),
      chats.length ? null : h('p', { class: 'hint' }, friends.length
        ? 'Pas encore de discussion avec tes amis. Ouvre l’onglet Amis et touche l’icône message pour écrire.'
        : 'Ajoute des amis dans l’onglet Amis pour discuter avec eux.'),
    ];
  }

  return [
    PageHeader({ eyebrow: 'Messagerie', title: 'Mes messages' }),
    tabs,
    incoming.length ? [
      SectionTitle(T`Demandes d’ami (${incoming.length})`),
      h('section', { class: 'card card--flush requests requests--in' }, incoming.map((f) => RequestRow(f, me, session.isAdmin))),
    ] : null,
    SectionTitle('Amis', h('div', { class: 'row-gap' },
      session.isAdmin ? h('button', { class: 'link-btn', type: 'button', onclick: () => adminAddFriendFlow(session) }, icon('shield', 16), 'Direct') : null,
      h('button', { class: 'link-btn', type: 'button', onclick: () => addFriendFlow(session) }, icon('plus', 16), 'Ajouter'))),
    friends.length
      ? h('nav', { class: 'card card--flush', 'aria-label': 'Amis' }, friends.map((f) => FriendRow(f, me)))
      : h('p', { class: 'hint' }, 'Ajoute tes partenaires d’entraînement avec leur code : une fois la demande acceptée, vous pourrez discuter et voir qui s’est entraîné.'),
    outgoing.length ? h('section', { class: 'card card--flush requests' }, outgoing.map((f) => PendingRow(f, me, session.isAdmin))) : null,
    h('section', { class: 'card friend-code' },
      h('p', { class: 'eyebrow' }, 'Mon code ami'),
      myCode
        ? h('p', { class: 'friend-code__value', 'aria-label': T`Code ${myCode.split('').join(' ')}` }, myCode)
        : codeFailed
          ? h('button', { class: 'btn btn--ghost', type: 'button', style: { margin: '10px 0' }, onclick: retryMyCode }, icon('reset', 18), 'Réessayer')
          : h('div', { class: 'spinner', style: { margin: '12px 0' } }),
      h('p', { class: 'muted small' }, 'Donne-le à un ami pour qu’il t’ajoute.'),
      myCode ? h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn--ink', type: 'button', onclick: shareCode }, icon('share', 18), 'Partager'),
        h('button', {
          class: 'btn btn--ghost', type: 'button',
          onclick: () => (navigator.clipboard?.writeText(myCode) || Promise.reject()).then(() => toast('Code copié'), () => toast('Copie impossible', { type: 'error' })),
        }, icon('copy', 18), 'Copier')) : null),
  ];
}

// ── Vue : discussion avec un ami ────────────────────────────────────────

let feed = null;
let messages = null;
let lastCount = 0;
const drafts = {};
const readMarked = {};

function ensureFeed(pid) {
  if (feed?.pid === pid) return;
  leaveFriendChat();
  feed = { pid, unsub: watchFriendMessages(pid, (list) => { messages = list; rerender(); }) };
}

export function leaveFriendChat() {
  feed?.unsub?.();
  feed = null;
  messages = null;
  lastCount = 0;
}

// ── Programme / diet / protocole reçu d'un ami ──────────────────────────

const NORMALIZE = { workout: normalizeWorkout, diet: normalizeDiet, protocol: normalizeProtocol };
const shareCache = new Map();     // id du message → contenu analysé (une seule analyse)
const handled = new Set();        // anti double-tap

function parseShare(m) {
  if (!shareCache.has(m.id)) {
    let data = null;
    try { data = NORMALIZE[m.cat]?.(JSON.parse(m.payload)) || null; } catch { data = null; }
    shareCache.set(m.id, data);
  }
  return shareCache.get(m.id);
}

function shareSummary(cat, d) {
  if (!d) return 'Contenu illisible';
  if (cat === 'workout') { const n = d.sessions.length; const e = d.sessions.reduce((a, x) => a + x.exercises.length, 0); return T`${n} séance${n > 1 ? 's' : ''} · ${e} exercice${e > 1 ? 's' : ''}`; }
  if (cat === 'diet') return T`${d.meals.length} repas${d.objective ? T` · ${d.objective} kcal` : ''}`;
  return T`${d.days.length} jour${d.days.length > 1 ? 's' : ''} de prises`;
}

async function answerShare(pid, m, accept) {
  if (handled.has(m.id)) return;
  handled.add(m.id);
  try {
    if (accept) {
      const data = parseShare(m);
      if (!data) throw new Error('Contenu illisible.');
      applyImport({ name: m.title, [m.cat]: structuredClone(data) }, { [m.cat]: true });
    }
    await answerFriendShare(pid, m.id, accept ? 'accepted' : 'refused');
    toast(accept ? T`${SHARE_LABEL[m.cat]} « ${m.title} » ajouté et activé` : 'Envoi refusé');
  } catch (err) {
    handled.delete(m.id);
    console.error('[share]', err);
    toast(err.message || 'Action impossible.', { type: 'error' });
  }
}

function ShareBubble(pid, m, mine, time) {
  const label = SHARE_LABEL[m.cat] || 'Envoi';
  const data = parseShare(m);
  const status = m.status || 'pending';
  const statusText = { pending: mine ? 'En attente de réponse' : null, accepted: 'Accepté', refused: 'Refusé' }[status];
  const ico = { workout: 'dumbbell', diet: 'leaf', protocol: 'pill' }[m.cat] || 'file';
  return h('div', { class: `share-msg${mine ? ' share-msg--mine' : ''}` },
    h('div', { class: 'share-msg__head' },
      h('span', { class: 'share-msg__icon', 'aria-hidden': 'true' }, icon(ico, 20)),
      h('div', { class: 'share-msg__txt' },
        h('p', { class: 'share-msg__eyebrow' }, mine ? T`Tu as envoyé · ${label}` : T`${label} reçu`),
        h('p', { class: 'share-msg__title' }, m.title || label),
        h('p', { class: 'share-msg__sub' }, shareSummary(m.cat, data)))),
    !mine && status === 'pending' && data
      ? h('div', { class: 'share-msg__actions' },
        h('button', { class: 'btn btn--primary', type: 'button', onclick: () => answerShare(pid, m, true) }, icon('check', 18), 'Accepter'),
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => answerShare(pid, m, false) }, 'Refuser'))
      : null,
    h('p', { class: 'share-msg__foot' },
      statusText ? h('span', { class: `share-msg__status share-msg__status--${status}` }, statusText) : null,
      h('span', {}, time)),
    !mine && status === 'pending' && data
      ? h('p', { class: 'share-msg__hint' }, 'Accepter l’ajoute comme nouveau profil, sans rien remplacer.') : null);
}

export function FriendChatView(session, pid) {
  const me = session.user.uid;
  const f = state.friendships.find((x) => x.id === pid);
  const back = IconButton('back', 'Retour', () => { location.hash = '#/contact'; }, 'icon-btn--soft');
  if (!f) {
    return [PageHeader({ eyebrow: 'Ami', title: '…', trailing: back }),
      state.friendships.length ? h('p', { class: 'muted' }, 'Cette amitié n’existe plus.') : Skeleton(2)];
  }
  if (!isAccepted(f)) {
    return [PageHeader({ eyebrow: 'Ami', title: f.names?.[friendOf(f, me)] || 'Ami', trailing: back }),
      h('p', { class: 'muted' }, isIncoming(f, me) ? 'Accepte sa demande dans Contact pour discuter.' : 'En attente de son acceptation.')];
  }
  ensureFeed(pid);
  // « Lu » écrit une seule fois par message reçu (pas à chaque rendu).
  if (unreadFriend(f, me) && readMarked[pid] !== ms(f.lastAt)) { readMarked[pid] = ms(f.lastAt); markFriendRead(me, pid); }

  const other = friendOf(f, me);
  const name = f.names?.[other] || 'Ami';
  const act = state.friendActivity[other];

  const header = PageHeader({
    eyebrow: 'Ami', title: name,
    trailing: h('div', { class: 'row-gap' },
      h('a', { href: `#/u/${encodeURIComponent(other)}`, 'aria-label': T`Voir le profil de ${name}` }, Avatar({ uid: other, name })),
      IconButton('more', 'Options', () => actionSheet({
        title: name,
        actions: [
          { label: 'Voir son profil', icon: 'user', onClick: () => { location.hash = `#/u/${encodeURIComponent(other)}`; } },
          { label: 'Supprimer la discussion', icon: 'trash', danger: true, onClick: async () => { if (await deleteChat('friend', session, f, name)) location.hash = '#/contact'; } },
          { label: 'Retirer de mes amis', icon: 'x', danger: true, onClick: async () => {
          const ok = await confirmSheet({ title: T`Retirer ${name} ?`, message: 'Votre discussion ne sera plus accessible.', confirmLabel: 'Retirer' });
          if (ok) { await removeFriend(pid); location.hash = '#/contact'; }
        } }],
      }), 'icon-btn--soft'),
      back),
  });

  if (messages === null) return [header, Skeleton(2)];
  // Discussion supprimée de mon côté : seuls les messages postérieurs s'affichent.
  const cleared = ms(f.clearedAt?.[me]);
  const shown = cleared ? messages.filter((m) => ms(m.at) > cleared) : messages;
  if (shown.length !== lastCount) { scrollToEnd(lastCount > 0); lastCount = shown.length; }
  drafts[pid] = drafts[pid] || { text: '' };

  return [
    header,
    trainedToday(act)
      ? h('p', { class: 'friend-status' }, icon('dumbbell', 16), T`S’est entraîné aujourd’hui${act.sessionName ? T` · ${act.sessionName}` : ''}`)
      : null,
    shown.length
      ? Thread(shown, me, { special: (m, mine, time) => (m.kind === 'share' ? ShareBubble(pid, m, mine, time) : null) })
      : h('p', { class: 'muted center' }, T`Commence la discussion avec ${name}.`),
    h('div', { class: 'composer-spacer' }),
    Composer({ id: `friend-input-${pid}`, draft: drafts[pid], placeholder: 'Message…', onSend: (t) => sendFriendMessage(me, pid, t) }),
  ];
}
