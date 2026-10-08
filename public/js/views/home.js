/**
 * Accueil — widgets du jour, toujours visibles (avec un état « vide » utile) :
 *   envois du coach · message · séance du jour · protocole (2 prochaines prises)
 *   · prochain repas + macros · poids.
 */
import { h } from '../lib/dom.js';
import { greeting, formatShortDate, frNum, formatWeekdays } from '../lib/dates.js';
import { nextMeal, nextProtocolItems, formatMinutes } from '../lib/schedule.js';
import { state, activeProfileId, profileData, sessionWeekKey, sessionCount, unreadCount } from '../store.js';
import { LiveLogo } from '../ui/logo.js';
import { Skeleton } from '../ui/layout.js';
import { icon } from '../ui/icons.js';
import { selectSession, nextSession, setSessionDone } from './training.js';
import { effectiveWeekdays, ItemRow, itemKey } from './protocol.js';
import { dietTotals, SupplementList } from './diet.js';
import { weightStats, WeightInput } from './weight.js';
import { unreadForUser, unreadForAdmin } from '../data/messages.js';
import { acceptItem, dismissItem, TYPE_LABEL } from '../data/inbox.js';
import { friendOf, unreadFriend, isAccepted, isIncoming } from '../data/friends.js';
import { trainedToday } from './messages-hub.js';
import { Avatar } from '../ui/avatar.js';
import { PostRow, recentPosts, recentMusic, shareMusicFlow, openMusic, sharePRFlow, LikeButton } from '../ui/feed.js';
import { MUSIC_SERVICES } from '../data/posts.js';

const MUSIC_LABEL = Object.fromEntries(Object.entries(MUSIC_SERVICES).map(([k, v]) => [k, v.label]));
import { InstallCard } from '../ui/install.js';
import { GoalsCompact } from './goals.js';
import { updateHome } from '../data/repo.js';
import { openSheet } from '../ui/sheet.js';
import { undoToast } from '../ui/toast.js';

import { T, tx } from '../lib/i18n.js';
import { LangButton } from '../ui/flag.js';
function Widget({ eyebrow, action, children, tone, cls = '' }) {
  return h('section', { class: `card widget${tone ? ` widget--${tone}` : ''} ${cls}` },
    h('div', { class: 'card__row' }, h('p', { class: 'eyebrow' }, eyebrow), action || null),
    children);
}

const link = (label, href) => h('a', { class: 'link-btn', href }, label, icon('chevron', 16));
const cta = (label, href) => h('a', { class: 'btn btn--ghost btn--block', href }, icon('plus', 18), label);

// ── Envois du coach ─────────────────────────────────────────────────────

function CoachSends(session) {
  if (!state.inbox.length) return null;
  return state.inbox.map((it) => Widget({
    eyebrow: T`${TYPE_LABEL[it.type] || 'Envoi'} de ton coach`,
    cls: 'coach-send',
    children: [
      h('p', { class: 'widget__title' }, it.title),
      it.message ? h('p', { class: 'muted' }, it.message) : null,
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn btn--primary', type: 'button',
          // Désactivé au 1er tap : un double tap n'importe pas deux fois le programme.
          onclick: (e) => { e.currentTarget.disabled = true; acceptItem(session.user.uid, it); },
        }, icon('check', 18), 'Ajouter et activer'),
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => dismissItem(session.user.uid, it) }, 'Ignorer')),
    ],
  }));
}

// ── Messages ────────────────────────────────────────────────────────────

/**
 * Bouton messages compact (à droite du prénom) : pastille du nombre de non-lus,
 * ouvre directement la bonne conversation quand il n'y en a qu'une.
 */
function MessagesButton(session) {
  const me = session.user.uid;
  const friendUnread = state.friendships.filter((f) => unreadFriend(f, me));
  const requests = state.friendships.filter((f) => isIncoming(f, me));
  let n = friendUnread.length + requests.length;
  let href = '#/contact';
  if (session.isAdmin) {
    const a = (state.adminConversations || []).filter(unreadForAdmin).length;
    if (a && !n) href = '#/admin/messages';
    n += a;
  } else if (unreadForUser(state.conversation)) {
    if (!n) href = '#/contact/coach';
    n += 1;
  }
  n = unreadCount();   // même total que la pastille de l'onglet Contact
  if (n === 1 && friendUnread.length === 1) href = `#/friends/${encodeURIComponent(friendUnread[0].id)}`;
  return h('a', {
    class: `msg-btn${n ? ' msg-btn--unread' : ''}`, href,
    'aria-label': n ? T`${n} message${n > 1 ? 's' : ''} non lu${n > 1 ? 's' : ''}` : 'Messages',
  },
  icon('message', 22),
  n ? h('span', { class: 'msg-btn__badge' }, n > 9 ? '9+' : String(n)) : null,
  h('span', { class: 'msg-btn__label' }, n ? (n > 1 ? 'Nouveaux' : 'Nouveau') : 'Messages'));
}

// ── Amis entraînés aujourd'hui ──────────────────────────────────────────

function FriendsWidget(session) {
  const me = session.user.uid;
  const friends = state.friendships.filter(isAccepted).map((f) => {
    const uid = friendOf(f, me);
    return { f, uid, name: f.names?.[uid] || 'Ami', act: state.friendActivity[uid] };
  });
  if (!friends.length) {
    return Widget({ eyebrow: 'Mes amis', cls: 'widget--compact', action: link('Ajouter', '#/contact'), children: [
      h('p', { class: 'muted small' }, 'Ajoute tes partenaires avec leur code ami pour voir qui s’est entraîné.')] });
  }
  friends.sort((a, b) => Number(trainedToday(b.act)) - Number(trainedToday(a.act)));
  const trainedN = friends.filter((x) => trainedToday(x.act)).length;
  const music = recentMusic(10);   // un son par personne, défilement horizontal
  // Dernier record (les musiques ont leur propre bloc).
  const lastPr = recentPosts(7, 6).find((p) => p.type !== 'music');
  return Widget({
    eyebrow: 'Mes amis aujourd’hui',
    cls: 'widget--compact',
    action: link(T`${trainedN}/${friends.length} entraîné${trainedN > 1 ? 's' : ''}`, '#/contact'),
    children: [
      h('div', { class: 'fstrip' }, friends.slice(0, 7).map((x) => {
        const done = trainedToday(x.act);
        return h('a', {
          class: `fstrip__item${done ? ' fstrip__item--done' : ''}`, href: `#/u/${encodeURIComponent(x.uid)}`,
          'aria-label': T`${x.name} : ${done ? T`entraîné (${x.act.sessionName || 'séance faite'})` : 'pas encore entraîné'}`,
        },
        h('span', { class: 'fstrip__ava' }, Avatar({ uid: x.uid, name: x.name, size: 'sm' }), done ? h('span', { class: 'fstrip__ok' }, icon('check', 10)) : null),
        h('span', { class: 'fstrip__name' }, String(x.name || 'Ami').split(' ')[0]));
      })),
      h('div', { class: 'music-head' },
        h('span', { class: 'eyebrow' }, icon('flame', 13), ' Records'),
        h('button', { class: 'link-btn', type: 'button', onclick: sharePRFlow }, icon('plus', 15), 'Partager')),
      lastPr ? h('ul', { class: 'records records--one' }, PostRow(lastPr, me))
        : h('p', { class: 'muted small' }, 'Aucun record cette semaine. Partage ta meilleure perf !'),
      h('div', { class: 'music-head' },
        h('span', { class: 'eyebrow' }, icon('music', 13), ' Sons conseillés'),
        h('button', { class: 'link-btn', type: 'button', onclick: shareMusicFlow }, icon('plus', 15), 'Partager')),
      music.length
        ? h('div', { class: 'music-list' }, music.map((m) => h('div', { class: `music-card music-card--${m.service}` },
          h('button', {
            class: 'music-card__main', type: 'button', onclick: () => openMusic(m),
            'aria-label': T`Écouter ${m.title || 'le son'} conseillé par ${m.owner === me ? 'toi' : m.name}`,
          },
          h('span', { class: 'music-card__play' }, icon('play', 14)),
          h('span', { class: 'music-card__body' },
            h('span', { class: 'music-card__title' }, m.title || 'Écouter le son'),
            h('span', { class: 'music-card__who' }, T`${m.owner === me ? 'Toi' : String(m.name || 'Ami').split(' ')[0]} · ${MUSIC_LABEL[m.service] || 'Musique'}`))),
          LikeButton(m, me))))
        : h('p', { class: 'muted small' }, 'Aucun son partagé. Lance la playlist de ta séance !'),
    ],
  });
}

// ── Séance du jour : la prochaine séance à faire ────────────────────────

function TodaySession() {
  const { session, plannedToday, sessions, doneToday, pid } = nextSession();
  if (!sessions?.length) {
    return Widget({ eyebrow: 'Séance du jour', cls: 'widget--compact', tone: 'ink', action: link('Créer', '#/training'), children: [
      h('p', { class: 'today-session__meta' }, 'Aucun programme pour le moment.')] });
  }
  if (!session) {
    return Widget({ eyebrow: 'Séances de la semaine', cls: 'widget--compact', tone: 'ink', action: link('Programme', '#/training'), children: [
      h('p', { class: 'today-session__name today-session__name--sm' }, 'Semaine bouclée ✓'),
      h('p', { class: 'today-session__meta' }, T`${sessions.length}/${sessions.length} séances faites. Repos bien mérité.`)] });
  }
  const n = (session.exercises || []).length;
  return Widget({
    eyebrow: doneToday.length ? T`${doneToday.map((x) => x.name).join(', ')} faite · ensuite` : plannedToday ? 'Séance du jour' : 'Prochaine séance',
    cls: 'widget--compact',
    tone: 'ink',
    children: h('div', { class: 'today-row' },
      h('a', { class: 'today-row__main', href: '#/training', onclick: () => selectSession(session.id) },
        h('span', { class: 'today-session__name' }, session.name),
        h('span', { class: 'today-session__meta' }, T`${n} exercice${n > 1 ? 's' : ''}${session.weekdays?.length ? T` · ${formatWeekdays(session.weekdays)}` : ''}`)),
      h('button', {
        class: 'today-row__check', type: 'button', 'aria-label': T`Marquer ${session.name} comme faite`,
        onclick: (e) => {
          e.currentTarget.disabled = true;
          setSessionDone(pid, session, true);
          undoToast(T`${session.name} terminée 💪`, () => setSessionDone(pid, session, false));
        },
      }, icon('check', 22)),
      h('a', { class: 'today-session__go', href: '#/training', 'aria-label': T`Ouvrir ${session.name}`, onclick: () => selectSession(session.id) }, icon('chevron', 22))),
  });
}

// ── Protocole : 2 prochaines prises ─────────────────────────────────────

function ProtocolWidget() {
  const pid = activeProfileId('protocol');
  if (!pid) {
    return Widget({ eyebrow: 'Protocole', cls: 'widget--compact', action: link('Créer', '#/protocol'), children: [
      h('p', { class: 'muted small' }, 'Aucun protocole pour le moment.')] });
  }
  const days = profileData('protocol').days || [];
  const dayOf = (it) => days.find((d) => (d.injections || []).includes(it));
  const { items, todayTotal, todayDone } = nextProtocolItems(
    days, (it) => Boolean(state.week[itemKey(pid, dayOf(it), it)]?.done), effectiveWeekdays, 2);

  const progress = todayTotal ? T`${todayDone}/${todayTotal} aujourd’hui` : null;
  return Widget({
    eyebrow: 'Prochaines prises',
    cls: 'widget--compact',
    action: link(progress || 'Planning', '#/protocol'),
    children: items.length
      ? h('div', { class: 'pr-list' }, items.map(({ item, day, minutes, tomorrow }) => (tomorrow
        ? h('div', { class: 'pr-row pr-row--later' },
          h('span', { class: 'pr-row__time pr-row__time--word' }, 'Demain', h('br'), item.time || formatMinutes(minutes)),
          h('span', { class: 'pr-row__body' }, h('span', { class: 'pr-row__name' }, item.name), item.type ? h('span', { class: 'pr-row__dose' }, item.type) : null))
        : ItemRow(pid, day, item, null, item.time || formatMinutes(minutes)))))
      : h('p', { class: 'muted' }, todayTotal ? 'Tout est fait pour aujourd’hui ✓' : 'Rien de prévu aujourd’hui ni demain.'),
  });
}

// ── Diet : prochain repas + macros du jour ──────────────────────────────

function DietWidget() {
  if (!activeProfileId('diet')) {
    return Widget({ eyebrow: 'Nutrition', children: [
      h('p', { class: 'muted' }, 'Aucune diet pour le moment.'), cta('Créer ma diet', '#/diet')] });
  }
  const d = profileData('diet');
  const totals = dietTotals(d);
  const target = { cal: d.objective || totals.cal, p: d.macros?.p || totals.p, g: d.macros?.g || totals.g, l: d.macros?.l || totals.l };
  const next = nextMeal(d.meals || []);

  let mealBlock;
  if (!next) {
    mealBlock = h('p', { class: 'muted' }, 'Ajoute tes repas dans Diet pour voir le prochain ici.');
  } else {
    const m = next.meal;
    const foods = m.foods || [];
    const mt = dietTotals({ meals: [m] });
    mealBlock = h('a', { class: 'next-meal', href: '#/diet' },
      h('div', { class: 'next-meal__head' },
        h('span', { class: 'next-meal__name' }, m.name),
        h('span', { class: 'next-meal__time' }, `${next.tomorrow ? 'Demain · ' : ''}${m.time || `~${formatMinutes(next.minutes)}`}`)),
      foods.length
        ? h('ul', { class: 'next-meal__foods' }, foods.slice(0, 5).map((f) => h('li', {}, h('span', {}, f.name), h('span', { class: 'muted' }, f.qty || ''))),
          foods.length > 5 ? h('li', { class: 'muted' }, T`+ ${foods.length - 5} autre(s)`) : null)
        : h('p', { class: 'muted small' }, 'Aucun aliment dans ce repas.'),
      h('p', { class: 'next-meal__macros' }, T`${mt.cal} kcal · P ${Math.round(mt.p)} · G ${Math.round(mt.g)} · L ${Math.round(mt.l)}`),
      SupplementList(m));
  }

  return Widget({
    eyebrow: 'Prochain repas',
    action: link('Diet', '#/diet'),
    children: [
      mealBlock,
      h('p', { class: 'eyebrow', style: { marginTop: '16px' } }, 'Objectifs du jour'),
      h('div', { class: 'macro-grid macro-grid--4' },
        [['kcal', target.cal], ['Prot. (g)', target.p], ['Gluc. (g)', target.g], ['Lip. (g)', target.l]]
          .map(([l, v]) => h('div', { class: 'macro-tile' }, h('span', { class: 'macro-tile__v' }, `${Math.round(v || 0)}`), h('span', { class: 'macro-tile__l' }, l)))),
    ],
  });
}

// ── Poids ───────────────────────────────────────────────────────────────

function WeightWidget() {
  const s = weightStats();
  return Widget({
    eyebrow: 'Poids',
    action: link('Suivi', '#/me/weight'),
    children: [
      s ? h('div', { class: 'kcal' },
        h('span', { class: 'kcal__big' }, frNum(s.last.kg)),
        h('span', { class: 'kcal__unit' }, ' kg'),
        s.delta7 != null ? h('span', { class: `trend${s.delta7 > 0 ? ' up' : s.delta7 < 0 ? ' down' : ''}` },
          T`${s.delta7 > 0 ? '+' : ''}${frNum(s.delta7)} kg / 7 j`) : null) : h('p', { class: 'muted' }, 'Première pesée ? Le matin, à jeun.'),
      s ? h('p', { class: 'muted small' }, T`Dernière pesée : ${formatShortDate(s.last.date)}`) : null,
      WeightInput({ compact: true }),
    ],
  });
}

// ── Objectifs & habitudes ───────────────────────────────────────────────

function GoalsWidget() {
  const goals = state.goals;
  if (!goals.items.length) {
    return Widget({ eyebrow: 'Habitudes', cls: 'widget--compact', action: link('Créer', '#/goals'), children: [
      h('p', { class: 'muted small' }, 'Fixe-toi des habitudes à cocher : eau, sommeil, séances…')] });
  }
  const { day, list, more } = GoalsCompact(goals, 3);
  return Widget({
    eyebrow: 'Habitudes du jour',
    cls: 'widget--compact',
    action: link(day.total ? T`${day.done}/${day.total} aujourd’hui` : 'Tout voir', '#/goals'),
    children: [list, more ? h('a', { class: 'link-btn', href: '#/goals', style: { marginTop: '8px' } }, T`+ ${more} autre(s)`, icon('chevron', 16)) : null],
  });
}

// ── Widgets personnalisables ────────────────────────────────────────────

export const WIDGETS = {
  session:  { label: 'Séance du jour',        icon: 'dumbbell', render: () => TodaySession() },
  goals:    { label: 'Objectifs & habitudes', icon: 'target',   render: () => GoalsWidget() },
  friends:  { label: 'Amis, records & sons',  icon: 'user',     render: (s) => FriendsWidget(s) },
  protocol: { label: 'Prochaines prises',     icon: 'pill',     render: () => ProtocolWidget() },
  diet:     { label: 'Prochain repas',        icon: 'leaf',     render: () => DietWidget() },
  weight:   { label: 'Poids',                 icon: 'scale',    render: () => WeightWidget() },
};
const DEFAULT_ORDER = ['session', 'friends', 'protocol', 'goals', 'diet', 'weight'];
/** Masqués tant que l'accueil n'a pas été personnalisé (pour tenir sur un écran). */
const DEFAULT_HIDDEN = ['diet', 'weight'];

/** Widgets visibles, dans l'ordre choisi (les nouveaux widgets s'ajoutent à la fin). */
function layout(home = state.home) {
  const hidden = new Set((home.order ? home.hidden || [] : DEFAULT_HIDDEN).filter((id) => WIDGETS[id]));
  const order = (home.order || DEFAULT_ORDER).filter((id, i, a) => WIDGETS[id] && a.indexOf(id) === i);
  // Widget ajouté dans une nouvelle version : inséré à sa place par défaut.
  DEFAULT_ORDER.forEach((id, i) => { if (!order.includes(id) && !hidden.has(id)) order.splice(Math.min(i, order.length), 0, id); });
  return { visible: order.filter((id) => !hidden.has(id)), hidden: DEFAULT_ORDER.filter((id) => hidden.has(id)) };
}

/** Panneau « Personnaliser l'accueil » : déplacer ↑↓, masquer, ajouter. */
function customize() {
  const list = h('div', { class: 'wedit' });
  const save = (visible, hidden) => { updateHome({ order: visible, hidden }); draw(); };

  function draw() {
    const { visible, hidden } = layout();
    const move = (i, d) => { const v = [...visible]; [v[i], v[i + d]] = [v[i + d], v[i]]; save(v, hidden); };
    // replaceChildren n'aplatit pas les tableaux → on aplatit (sinon « [object …] »).
    list.replaceChildren(...[
      h('p', { class: 'eyebrow' }, T`Affichés (${visible.length})`),
      h('div', { class: 'wedit__list' }, visible.map((id, i) => h('div', { class: 'wedit__row' },
        h('span', { class: 'wedit__icon' }, icon(WIDGETS[id].icon, 18)),
        h('span', { class: 'wedit__label' }, WIDGETS[id].label),
        h('button', { class: 'icon-btn icon-btn--ghost', type: 'button', 'aria-label': T`Monter ${WIDGETS[id].label}`, disabled: i === 0, onclick: () => move(i, -1) }, icon('up', 18)),
        h('button', { class: 'icon-btn icon-btn--ghost', type: 'button', 'aria-label': T`Descendre ${WIDGETS[id].label}`, disabled: i === visible.length - 1, onclick: () => move(i, 1) }, icon('down', 18)),
        h('button', {
          class: 'icon-btn icon-btn--ghost wedit__hide', type: 'button', 'aria-label': T`Masquer ${WIDGETS[id].label}`,
          onclick: () => save(visible.filter((x) => x !== id), [...hidden, id]),
        }, icon('eyeOff', 18))))),
      hidden.length ? [
        h('p', { class: 'eyebrow', style: { marginTop: '16px' } }, 'Disponibles'),
        h('div', { class: 'wedit__list' }, hidden.map((id) => h('button', {
          class: 'wedit__row wedit__row--add', type: 'button', onclick: () => save([...visible, id], hidden.filter((x) => x !== id)),
        },
        h('span', { class: 'wedit__icon' }, icon(WIDGETS[id].icon, 18)),
        h('span', { class: 'wedit__label' }, WIDGETS[id].label),
        h('span', { class: 'wedit__plus' }, icon('plus', 18), 'Ajouter')))),
      ] : null,
      h('button', { class: 'btn btn--quiet btn--block', type: 'button', style: { marginTop: '16px' }, onclick: () => save([...DEFAULT_ORDER], [...DEFAULT_HIDDEN]) },
        icon('reset', 18), 'Disposition par défaut'),
    ].flat().filter(Boolean));
  }
  draw();
  openSheet({ title: 'Personnaliser l’accueil', subtitle: 'Déplace, masque ou ajoute des widgets. Synchronisé sur tous tes appareils.', body: list });
}

/** Raccourci partenaire HSN (lien affilié), ouvert dans Safari. */
const HSN_URL = 'https://www.hsnstore.fr/affiliate/click/index?linkid=Y2F0ZWdvcnl8fDN8fEpGQVNLQXx8aHR0cHM6Ly93d3cuaHNuc3RvcmUuZnIvbnV0cml0aW9uLXNwb3J0aXZl';
function HsnButton() {
  return h('a', { class: 'hsn-btn', href: HSN_URL, target: '_blank', rel: 'noopener noreferrer sponsored', 'aria-label': 'HSN, nutrition sportive' },
    h('span', { class: 'hsn-btn__logo' }, 'HSN'),
    h('span', { class: 'hsn-btn__label' }, 'Nutrition'));
}

export function HomeView(session) {
  const first = (session.user.displayName || '').split(' ')[0];
  const head = h('header', { class: 'home-head' },
    h('div', { class: 'topbar topbar--home' },
      LiveLogo(),
      // Barre d'outils compacte : compteur · langue · personnaliser (tient sur un iPhone 375 px).
      h('div', { class: 'home-tools' },
        h('a', { class: 'home-tools__count', href: '#/training', 'aria-label': 'Séances effectuées' },
          h('span', { class: 'home-tools__value' }, String(sessionCount())), h('span', { class: 'home-tools__label' }, 'séances')),
        LangButton({ cls: 'home-tools__btn' }),
        h('button', { class: 'home-tools__btn', type: 'button', 'aria-label': 'Personnaliser l’accueil', onclick: customize }, icon('layout', 20)))),
    h('div', { class: 'home-hello' },
      h('div', { style: { minWidth: 0 } },
        h('p', { class: 'eyebrow' }, T`${tx(greeting())} · ${formatShortDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })}`),
        h('h1', { class: 'page-title' }, first || 'Athlète')),
      h('div', { class: 'home-hello__actions' },
        HsnButton(),
        state.ready ? MessagesButton(session) : null)));

  if (!state.ready) return [head, Skeleton(5)];
  const { visible } = layout();
  return [
    head,
    InstallCard(),               // seulement hors app installée
    CoachSends(session),         // envois du coach : visibles en haut quand il y en a
    visible.map((id) => WIDGETS[id].render(session)),
  ];
}
