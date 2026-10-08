/**
 * Page profil d'un ami (ou la mienne, « telle que mes amis la voient ») :
 * photo, séances, poids, records et sons partagés, programme, diet, protocole.
 *
 * N'affiche QUE ce que la personne a choisi de partager (shared/{uid}) ;
 * le contenu reçu repasse par les normaliseurs (jamais utilisé tel quel).
 * Lectures : 1 document + 10 publications, à l'ouverture (temps réel ensuite).
 */
import { h } from '../lib/dom.js';
import { frNum, formatWeekdays, formatShortDate } from '../lib/dates.js';
import { state } from '../store.js';
import { watchShared, SHARE_ITEMS, sharePrefs, setSharePrefs, setNote, myNote, cleanNote } from '../data/shared.js';
import { watchPosts } from '../data/posts.js';
import { friendOf, isAccepted, pairOf } from '../data/friends.js';
import { normalizeWorkout, normalizeDiet, normalizeProtocol } from '../lib/schema.js';
import { applyImport } from '../data/importer.js';
import { PageHeader, IconButton, Skeleton } from '../ui/layout.js';
import { Avatar } from '../ui/avatar.js';
import { PostRow } from '../ui/feed.js';
import { icon } from '../ui/icons.js';
import { confirmSheet, formSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { dietTotals } from './diet.js';
import { trainedToday } from './messages-hub.js';

import { T } from '../lib/i18n.js';
const rerender = () => window.dispatchEvent(new Event('app:render'));

// Abonnements de la page ouverte (coupés en la quittant).
const view = { uid: null, shared: undefined, denied: false, posts: null, unsubs: [] };
const opened = new Set();   // sections dépliées (survivent aux re-rendus)

function open(uid) {
  if (view.uid === uid) return;
  leaveProfile();
  Object.assign(view, { uid, shared: undefined, denied: false, posts: null });
  view.unsubs.push(watchShared(uid, (d, err) => { view.shared = d; view.denied = Boolean(err); rerender(); }));
  view.unsubs.push(watchPosts(uid, (list) => { view.posts = list; rerender(); }, 10));
}

export function leaveProfile() {
  view.unsubs.forEach((u) => u?.());
  view.unsubs = [];
  view.uid = null;
}

/** Bloc repliable (état gardé entre deux rendus). */
function Fold(key, summary, body) {
  const el = h('details', { class: 'pfold', ontoggle: () => (el.open ? opened.add(key) : opened.delete(key)) },
    h('summary', { class: 'pfold__sum' }, summary, icon('chevron', 16)),
    h('div', { class: 'pfold__body' }, body));
  if (opened.has(key)) el.open = true;
  return el;
}

/** « Ajouter à mes programmes / diets / protocoles » (nouveau profil, rien d'écrasé). */
async function copyToMine(cat, data, title, owner) {
  const label = { workout: 'programme', diet: 'diet', protocol: 'protocole' }[cat];
  const name = `${title || label} (${owner})`.slice(0, 60);
  if (!(await confirmSheet({ title: T`Ajouter ce ${label} ?`, message: T`« ${name} » sera ajouté à tes ${label}s et activé. Rien n’est remplacé.`, confirmLabel: 'Ajouter', danger: false }))) return;
  applyImport({ name, [cat]: structuredClone(data) }, { [cat]: true });
  toast(T`${label[0].toUpperCase() + label.slice(1)} « ${name} » ajouté`);
}

/** Ce que voient mes amis (rien n'est envoyé sans être coché). */
async function editSharing() {
  const cur = sharePrefs();
  const r = await formSheet({
    title: 'Ce que voient mes amis',
    subtitle: 'Sur ton profil. Tes records et sons partagés y apparaissent toujours. Ce qui n’est pas coché n’est jamais envoyé.',
    fields: SHARE_ITEMS.map(([key, label, hint]) => ({ name: key, type: 'toggle', label, hint, value: cur[key] })),
    submitLabel: 'Enregistrer',
  });
  if (!r?.values) return;
  try { await setSharePrefs(r.values); toast('Partage mis à jour'); } catch { toast('Enregistrement impossible. Vérifie ta connexion.', { type: 'error' }); }
}

/** Note affichée en haut de mon profil (humeur, objectif du moment…). */
async function editNote(current) {
  const r = await formSheet({
    title: 'Ma note',
    subtitle: 'Affichée en haut de ton profil pour tes amis. Laisse vide pour la retirer.',
    fields: [{ name: 'note', type: 'textarea', label: 'Note', maxlength: 200, value: current || '', placeholder: 'Ex. Objectif 140 kg au DC avant l’été 💪' }],
    submitLabel: 'Publier',
  });
  if (!r?.values) return;
  try { await setNote(r.values.note); toast(cleanNote(r.values.note) ? 'Note publiée' : 'Note retirée'); } catch { toast('Enregistrement impossible. Vérifie ta connexion.', { type: 'error' }); }
}

const Stat = (value, label) => h('div', { class: 'pstat' }, h('span', { class: 'pstat__value' }, value), h('span', { class: 'pstat__label' }, label));

function WorkoutCard(w, owner, isMe) {
  const n = w.sessions.reduce((a, s) => a + s.exercises.length, 0);
  return h('section', { class: 'card pcard-sec' },
    h('div', { class: 'card__row' }, h('p', { class: 'eyebrow' }, icon('dumbbell', 13), ' Programme'),
      isMe ? null : h('button', { class: 'link-btn', type: 'button', onclick: () => copyToMine('workout', w, w.name, owner) }, icon('plus', 15), 'Copier')),
    h('p', { class: 'pcard-sec__title' }, w.name || 'Programme'),
    h('p', { class: 'muted small' }, T`${w.sessions.length} séance${w.sessions.length > 1 ? 's' : ''} · ${n} exercice${n > 1 ? 's' : ''}`),
    w.sessions.map((s, i) => Fold(`w${i}`,
      h('span', { class: 'pfold__title' }, s.name, s.weekdays?.length ? h('span', { class: 'pfold__meta' }, T` · ${formatWeekdays(s.weekdays)}`) : null),
      h('ol', { class: 'plist' }, s.exercises.map((e) => h('li', {},
        h('span', { class: 'plist__main' }, e.n),
        h('span', { class: 'plist__meta' }, [e.s !== '—' && e.s, e.r !== '—' && T`repos ${e.r}`].filter(Boolean).join(' · '))))))));
}

function DietCard(d, owner, isMe) {
  const t = dietTotals(d);
  const kcal = d.objective || Math.round(t.cal);
  const m = d.macros?.p || d.macros?.g || d.macros?.l ? d.macros : { p: Math.round(t.p), g: Math.round(t.g), l: Math.round(t.l) };
  return h('section', { class: 'card pcard-sec' },
    h('div', { class: 'card__row' }, h('p', { class: 'eyebrow' }, icon('leaf', 13), ' Diet'),
      isMe ? null : h('button', { class: 'link-btn', type: 'button', onclick: () => copyToMine('diet', d, d.name, owner) }, icon('plus', 15), 'Copier')),
    h('p', { class: 'pcard-sec__title' }, d.name || 'Diet'),
    h('div', { class: 'pmacros' },
      Stat(kcal ? `${kcal}` : '—', 'kcal'), Stat(`${m.p || 0} g`, 'Protéines'), Stat(`${m.g || 0} g`, 'Glucides'), Stat(`${m.l || 0} g`, 'Lipides')),
    d.meals.map((meal, i) => Fold(`d${i}`,
      h('span', { class: 'pfold__title' }, meal.name, meal.time ? h('span', { class: 'pfold__meta' }, T` · ${meal.time}`) : null),
      h('ul', { class: 'plist' },
        (meal.foods || []).map((f) => h('li', {}, h('span', { class: 'plist__main' }, f.name), h('span', { class: 'plist__meta' }, [f.qty, f.cal ? `${f.cal} kcal` : null].filter(Boolean).join(' · ')))),
        (meal.supplements || []).map((s) => h('li', {}, h('span', { class: 'plist__main' }, `💊 ${s.name}`), h('span', { class: 'plist__meta' }, s.dose || '')))))));
}

function ProtocolCard(p, owner, isMe) {
  const items = p.days.flatMap((d) => d.injections.map((i) => ({ d, i })));
  return h('section', { class: 'card pcard-sec' },
    h('div', { class: 'card__row' }, h('p', { class: 'eyebrow' }, icon('pill', 13), ' Protocole'),
      isMe ? null : h('button', { class: 'link-btn', type: 'button', onclick: () => copyToMine('protocol', p, p.name, owner) }, icon('plus', 15), 'Copier')),
    h('p', { class: 'pcard-sec__title' }, p.name || 'Protocole'),
    p.products.length
      ? h('ul', { class: 'plist' }, p.products.map((x) => h('li', {}, h('span', { class: 'plist__main' }, x.name), h('span', { class: 'plist__meta' }, x.dose || ''))))
      : null,
    items.length ? Fold('p0', h('span', { class: 'pfold__title' }, T`Planning · ${items.length} prise${items.length > 1 ? 's' : ''}`),
      h('ul', { class: 'plist' }, items.map(({ d, i }) => h('li', {},
        h('span', { class: 'plist__main' }, i.name, i.type ? h('span', { class: 'plist__meta' }, T` · ${i.type}`) : null),
        h('span', { class: 'plist__meta' }, [d.weekdays?.length ? formatWeekdays(d.weekdays) : d.name, i.time].filter(Boolean).join(' · ')))))) : null);
}

export function ProfileView(session, uid) {
  const me = session.user.uid;
  const isMe = uid === me;
  const back = IconButton('back', 'Retour', () => history.length > 1 ? history.back() : (location.hash = '#/home'), 'icon-btn--soft');
  const f = isMe ? null : state.friendships.find((x) => x.id === pairOf(me, uid));

  if (!isMe && (!f || !isAccepted(f))) {
    return [PageHeader({ eyebrow: 'Profil', title: '…', trailing: back }),
      h('p', { class: 'muted' }, state.friendships.length ? 'Ce profil est visible uniquement par ses amis.' : 'Chargement…')];
  }
  open(uid);

  const sh = view.shared;
  const name = String(sh?.name || (isMe ? session.user.displayName : f?.names?.[uid]) || 'Ami');
  const first = name.split(' ')[0];
  const act = isMe ? null : state.friendActivity[uid];
  // En-tête discret : la carte de profil porte le nom.
  const header = h('div', { class: 'ptop' }, h('p', { class: 'eyebrow' }, isMe ? 'Mon profil' : 'Profil'), back);

  const statusLine = act && trainedToday(act)
    ? h('p', { class: 'phero__status phero__status--on' }, icon('dumbbell', 14), T`Entraîné aujourd’hui${act.sessionName ? T` · ${act.sessionName}` : ''}`)
    : h('p', { class: 'phero__status' }, isMe ? 'Voici ce que voient tes amis' : 'Pas encore entraîné aujourd’hui');
  const action = isMe
    ? h('button', { class: 'btn btn--ghost phero__btn', type: 'button', onclick: editSharing }, icon('eye', 16), 'Ce que voient mes amis')
    : h('a', { class: 'btn btn--primary phero__btn', href: `#/friends/${encodeURIComponent(f.id)}` }, icon('message', 16), 'Message');
  const heroParts = (extra = []) => h('section', { class: 'card phero' },
    h('div', { class: 'phero__ava' }, Avatar({ uid, name, photoURL: isMe ? session.user.photoURL : null, size: 'lg' })),
    h('h1', { class: 'phero__name' }, name),
    statusLine,
    ...extra,
    action);
  const hero = heroParts();

  if (sh === undefined && !view.denied) return [header, hero, Skeleton(3)];

  // Contenu partagé, re-validé.
  const w = sh?.workout ? { name: String(sh.workout.name || '').slice(0, 60), ...normalizeWorkout(sh.workout) } : null;
  const d = sh?.diet ? { name: String(sh.diet.name || '').slice(0, 60), ...normalizeDiet(sh.diet) } : null;
  const p = sh?.protocol ? { name: String(sh.protocol.name || '').slice(0, 60), ...normalizeProtocol(sh.protocol) } : null;
  const weight = sh?.weight && Number(sh.weight.kg) > 0 ? sh.weight : null;
  const posts = (view.posts || []);
  const prs = posts.filter((x) => x.type === 'pr');
  const noteText = cleanNote(sh?.note ?? (isMe ? myNote() : ''));
  const stats = [
    Number.isInteger(sh?.sessions) ? Stat(String(sh.sessions), 'séances') : null,
    weight ? Stat(`${frNum(weight.kg, weight.kg % 1 ? 1 : 0)} kg`, weight.date ? T`poids · ${formatShortDate(weight.date, { day: 'numeric', month: 'short' })}` : 'poids') : null,
    d ? Stat(String(d.objective || Math.round(dietTotals(d).cal) || '—'), 'kcal / jour') : null,
    Stat(String(prs.length), `record${prs.length > 1 ? 's' : ''}`),
  ].filter(Boolean);

  const nothing = !w && !d && !p && !weight && !Number.isInteger(sh?.sessions);
  const noteEl = noteText || isMe ? h('div', { class: `pnote${noteText ? '' : ' pnote--empty'}` },
    h('p', { class: 'pnote__text', translate: noteText ? 'no' : null }, noteText || 'Ajoute une note : ton objectif, ta prépa, ton mood du moment…'),
    isMe ? h('button', { class: 'link-btn pnote__edit', type: 'button', onclick: () => editNote(noteText) }, icon('edit', 15), noteText ? 'Modifier' : 'Écrire une note') : null) : null;
  const heroFull = heroParts([noteEl, stats.length ? h('div', { class: 'pstats' }, stats) : null]);

  return [
    header,
    heroFull,
    // Records et sons réunis, du plus récent au plus ancien.
    posts.length ? h('section', { class: 'card pcard-sec' },
      h('p', { class: 'eyebrow' }, icon('flame', 13), ' Records & sons partagés'),
      h('ul', { class: 'records' }, posts.map((x) => PostRow(x, me)))) : null,
    w ? WorkoutCard(w, first, isMe) : null,
    d ? DietCard(d, first, isMe) : null,
    p ? ProtocolCard(p, first, isMe) : null,
    nothing ? h('p', { class: 'muted center' }, isMe
      ? 'Tu ne partages rien pour l’instant. Touche « Ce que voient mes amis » en haut pour choisir.'
      : T`${first} ne partage pas encore son programme, sa diet ou son protocole.`) : null,
  ];
}
