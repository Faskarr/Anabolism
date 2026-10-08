/**
 * Contact — conversation de l'utilisateur avec l'administrateur (coach).
 */
import { h } from '../lib/dom.js';
import { state } from '../store.js';
import { watchMessages, sendUserMessage, markReadByUser, unreadForUser, ms } from '../data/messages.js';

let readMarked = 0;   // « lu » écrit une seule fois par réponse reçue
import { PageHeader, Skeleton, IconButton } from '../ui/layout.js';
import { Thread, Composer, scrollToEnd } from '../ui/chat.js';
import { icon } from '../ui/icons.js';

// État de l'écran (persiste entre deux rendus).
let feed = null;          // { uid, unsub }
let messages = null;      // null = chargement
let lastCount = 0;
const draft = { text: '' };

function ensureFeed(uid) {
  if (feed?.uid === uid) return;
  leaveContact();
  messages = null;
  feed = {
    uid,
    unsub: watchMessages(uid, (list) => {
      messages = list;
      window.dispatchEvent(new Event('app:render'));
    }),
  };
}

/** Appelé par le routeur quand on quitte l'écran. */
export function leaveContact() {
  feed?.unsub?.();
  feed = null;
  messages = null;
  lastCount = 0;
}

export function ContactView(session) {
  const uid = session.user.uid;
  ensureFeed(uid);

  // Ouvrir l'écran = lire la réponse.
  const c = state.conversation;
  if (unreadForUser(c) && readMarked !== ms(c.lastAt)) { readMarked = ms(c.lastAt); markReadByUser(uid); }

  const header = PageHeader({
    eyebrow: 'Messagerie', title: 'Mon coach',
    trailing: IconButton('back', 'Retour', () => { location.hash = '#/contact'; }, 'icon-btn--soft'),
  });

  if (messages === null) return [header, Skeleton(2)];
  // Discussion supprimée de mon côté : seuls les messages postérieurs s'affichent.
  const cleared = ms(c?.userClearedAt);
  const shown = cleared ? messages.filter((m) => ms(m.at) > cleared) : messages;

  // Défilement en bas à l'ouverture et à chaque nouveau message.
  if (shown.length !== lastCount) { scrollToEnd(lastCount > 0); lastCount = shown.length; }

  const intro = shown.length ? null : h('section', { class: 'card contact-intro' },
    h('div', { class: 'empty__icon' }, icon('message', 26)),
    h('p', { class: 'card__title' }, 'Écris à ton coach'),
    h('p', { class: 'card__text' },
      'Une question sur ton programme, ta diet ou ton protocole ? La réponse arrivera ici, et un badge te préviendra.'));

  const status = state.conversation?.status === 'done' && shown.length
    ? h('p', { class: 'thread__day' }, 'Conversation marquée comme traitée — écris pour la rouvrir')
    : null;

  return [
    header,
    intro,
    Thread(shown, 'user'),
    status,
    h('div', { class: 'composer-spacer' }),
    Composer({
      id: 'contact-input', draft, placeholder: 'Écrire un message…',
      onSend: (text) => sendUserMessage(session.user, text),
    }),
  ];
}
