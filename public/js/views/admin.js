/**
 * ADMIN — tableau de bord, liste des utilisateurs et fiche détaillée.
 *
 * Gestion possible depuis la fiche :
 *  • voir poids, programmes (+ charges), diets, protocoles, semaine en cours ;
 *  • envoyer un programme / diet / protocole (proposé ou installé directement) ;
 *  • rendre actif, renommer, supprimer un profil de l'utilisateur ;
 *  • désactiver / réactiver le compte (aucune donnée supprimée) ;
 *  • ouvrir la conversation.
 */
import { h } from '../lib/dom.js';
import { frNum, formatShortDate, formatWeekdays, isoWeekday } from '../lib/dates.js';
import { uid as newId } from '../lib/ids.js';
import { parseImport, normalizeWorkout, normalizeDiet, normalizeProtocol } from '../lib/schema.js';
import { state, profileData, ensureAdminUsers } from '../store.js';
import { ms, unreadForAdmin } from '../data/messages.js';
import {
  watchUserData, watchUserInbox, setUserStatus, proposeToUser, cancelProposal,
  installProfileForUser, renameUserProfile, setUserActiveProfile, deleteUserProfile, setUserGoals, deleteUserAccount, renameUser,
} from '../data/admin.js';
import { GoalsBoard, editGoal } from './goals.js';
import { periodKey } from '../data/goals.js';
import { librarySources } from './admin-library.js';
import { PageHeader, IconButton, Skeleton, Empty, SectionTitle } from '../ui/layout.js';
import { openSheet, formSheet, confirmSheet, actionSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { Avatar as AvatarUI } from '../ui/avatar.js';
import { lineChart } from '../ui/chart.js';
import { dietTotals, MacroBar, SupplementList } from './diet.js';
import { weightStats } from './weight.js';
import { effectiveWeekdays, itemKey } from './protocol.js';
import { est1RM } from './training.js';

import { T, tx, locale } from '../lib/i18n.js';
const rerender = () => window.dispatchEvent(new Event('app:render'));
const DAY = 86400000;
const CAT_LABEL = { workout: 'Programme', diet: 'Diet', protocol: 'Protocole' };
const DATA_KEY = { workout: 'workouts', diet: 'diet', protocol: 'protocol' };
const NORMALIZE = { workout: normalizeWorkout, diet: normalizeDiet, protocol: normalizeProtocol };

/** « aujourd'hui », « hier », « il y a 5 j », « 3 sept. » */
function ago(v) {
  const t = ms(v);
  if (!t) return 'jamais';
  const days = Math.floor((Date.now() - t) / DAY);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 30) return T`il y a ${days} j`;
  return new Date(t).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: days > 330 ? 'numeric' : undefined });
}

function Avatar(u, size = '') {
  return AvatarUI({ uid: u.id, name: u.displayName || u.email, photoURL: u.photoURL, size: size.replace('avatar--', '') });
}

const Stat = (value, label, tone = '') => h('div', { class: `stat${tone ? ` stat--${tone}` : ''}` },
  h('span', { class: 'stat__value' }, String(value)), h('span', { class: 'stat__label' }, label));

// ═══ Tableau de bord + liste ═══════════════════════════════════════════

const list = { filter: 'all', search: '' };
const FILTERS = [['all', 'Tous'], ['active', 'Actifs'], ['inactive', 'Inactifs 14 j+'], ['disabled', 'Désactivés'], ['unread', 'Messages']];

export function AdminHomeView() {
  ensureAdminUsers();
  const header = PageHeader({
    eyebrow: 'Admin', title: 'Utilisateurs',
    trailing: IconButton('back', 'Retour', () => { location.hash = '#/me'; }, 'icon-btn--soft'),
  });
  const users = state.adminUsers;
  if (users === null) return [header, Skeleton(5)];

  const now = Date.now();
  const convs = new Map((state.adminConversations || []).map((c) => [c.id, c]));
  const unreadIds = new Set([...convs.values()].filter(unreadForAdmin).map((c) => c.id));
  const isActive7 = (u) => now - ms(u.lastActiveAt) < 7 * DAY;
  const isInactive14 = (u) => now - ms(u.lastActiveAt) >= 14 * DAY;
  const q = list.search.trim().toLowerCase();

  const shown = users.filter((u) => {
    if (list.filter === 'active' && !(u.status !== 'disabled' && isActive7(u))) return false;
    if (list.filter === 'inactive' && !(u.status !== 'disabled' && isInactive14(u))) return false;
    if (list.filter === 'disabled' && u.status !== 'disabled') return false;
    if (list.filter === 'unread' && !unreadIds.has(u.id)) return false;
    if (q && !`${u.displayName || ''} ${u.email || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const search = h('input', {
    class: 'input', id: 'adm-users-search', type: 'search', autocomplete: 'off',
    placeholder: 'Rechercher un nom ou un e-mail…', 'aria-label': 'Rechercher un utilisateur',
    oninput: (e) => { list.search = e.target.value; rerender(); },
  });
  search.value = list.search;

  return [
    header,
    h('div', { class: 'stats stats--4' },
      Stat(users.length, 'Inscrits'),
      Stat(users.filter(isActive7).length, 'Actifs 7 j'),
      Stat(users.filter((u) => now - ms(u.createdAt) < 30 * DAY).length, 'Nouveaux 30 j'),
      Stat(users.filter((u) => u.status === 'disabled').length, 'Désactivés')),
    h('a', { class: 'card admin-link', href: '#/admin/messages' },
      h('span', { class: 'menu-row__icon' }, icon('message', 20)),
      h('span', { class: 'menu-row__label' }, 'Messages'),
      unreadIds.size ? h('span', { class: 'count-badge' }, String(unreadIds.size)) : h('span', { class: 'muted' }, 'à jour'),
      h('span', { class: 'menu-row__chevron' }, icon('chevron', 18))),
    h('a', { class: 'card admin-link', href: '#/admin/links' },
      h('span', { class: 'menu-row__icon' }, icon('link', 20)),
      h('span', { class: 'menu-row__label' }, 'Liens utiles'),
      h('span', { class: 'muted' }, 'affichés dans Moi'),
      h('span', { class: 'menu-row__chevron' }, icon('chevron', 18))),
    h('a', { class: 'card admin-link', href: '#/admin/library' },
      h('span', { class: 'menu-row__icon' }, icon('book', 20)),
      h('span', { class: 'menu-row__label' }, 'Bibliothèque de programmes'),
      h('span', { class: 'muted' }, 'modèles à envoyer'),
      h('span', { class: 'menu-row__chevron' }, icon('chevron', 18))),
    h('button', { class: 'card admin-link', type: 'button', onclick: backupFlow },
      h('span', { class: 'menu-row__icon' }, icon('download', 20)),
      h('span', { class: 'menu-row__label' }, 'Sauvegarder la base'),
      h('span', { class: 'muted' }, backupAge()),
      h('span', { class: 'menu-row__chevron' }, icon('chevron', 18))),
    search,
    h('div', { class: 'chips' }, FILTERS.map(([key, label]) => h('button', {
      class: `chip${list.filter === key ? ' chip--on' : ''}`, type: 'button',
      onclick: () => { list.filter = key; rerender(); },
    }, label))),
    shown.length
      ? h('nav', { class: 'card card--flush', 'aria-label': 'Utilisateurs' }, shown.map((u) => h('a', {
        class: `conv${u.status === 'disabled' ? ' conv--disabled' : ''}`, href: `#/admin/user/${encodeURIComponent(u.id)}`,
      },
      Avatar(u),
      h('span', { class: 'conv__body' },
        h('span', { class: 'conv__top' },
          h('span', { class: 'conv__name' }, u.displayName || 'Sans nom'),
          h('span', { class: 'conv__when' }, ago(u.lastActiveAt))),
        h('span', { class: 'conv__preview' },
          [u.lastWeight != null ? `${frNum(u.lastWeight)} kg` : null, u.email].filter(Boolean).join(' · '))),
      unreadIds.has(u.id) ? h('span', { class: 'dot', 'aria-label': 'Message non lu' }) : null,
      u.status === 'disabled' ? h('span', { class: 'tag tag--danger' }, 'Désactivé') : null)))
      : Empty({ iconName: 'user', title: 'Aucun utilisateur', text: users.length ? 'Change le filtre ou la recherche.' : 'Les comptes apparaîtront ici après leur première connexion.' }),
  ];
}

// ═══ Sauvegarde de la base ═════════════════════════════════════════════
// Module chargé à la demande (hors du graphe de démarrage).
const loadBackup = () => import('../data/backup.js');
let lastBackupCache = null;

/** « jamais », « aujourd'hui », « il y a 3 j » — rappel discret dans la liste. */
function backupAge() {
  if (lastBackupCache === null) {
    loadBackup().then((m) => { lastBackupCache = m.lastBackupAt(); rerender(); }).catch(() => {});
    return '';
  }
  if (!lastBackupCache) return 'jamais';
  const days = Math.floor((Date.now() - lastBackupCache) / DAY);
  return days === 0 ? "aujourd'hui" : T`il y a ${days} j`;
}

/**
 * 1) export (quelques secondes, progression affichée) ;
 * 2) bouton « Enregistrer » : la feuille de partage iOS exige un tap RÉCENT,
 *    on ne peut donc pas l'ouvrir automatiquement à la fin de l'export.
 */
function backupFlow() {
  const status = h('p', { class: 'muted' }, 'Préparation…');
  const actions = h('div', { class: 'form__actions' });
  const sheet = openSheet({
    title: 'Sauvegarde de la base',
    subtitle: 'Toutes les données de tous les comptes, dans un fichier à garder dans Fichiers.',
    body: h('div', {}, status, actions),
  });

  loadBackup()
    .then((m) => m.exportDatabase((step) => { status.textContent = T`Lecture : ${step}…`; })
      .then((res) => ({ m, res })))
    .then(({ m, res }) => {
      status.textContent = T`${res.count} documents · ${res.sizeKb} Ko — prêt.`;
      actions.replaceChildren(
        h('button', {
          class: 'btn btn--primary btn--block', type: 'button',
          onclick: async () => {
            if (await m.saveBackupFile(res.file)) {
              lastBackupCache = m.lastBackupAt();
              sheet.close();
              toast('Sauvegarde enregistrée');
              rerender();
            }
          },
        }, icon('download', 18), ' Enregistrer dans Fichiers'),
        h('p', { class: 'muted' }, 'Dans la feuille de partage : « Enregistrer dans Fichiers ».'));
    })
    .catch((err) => {
      console.error('[admin] sauvegarde', err);
      status.textContent = err?.code === 'permission-denied'
        ? tx('Accès refusé : déploie les règles Firestore (firebase deploy --only firestore:rules).')
        : T`Échec : ${err?.code || err?.message || err}`;
    });
}

// ═══ Fiche utilisateur ═════════════════════════════════════════════════

let feed = null;      // { uid, unsubs }
let data = null;      // données de l'utilisateur
let inbox = [];
const ui = { tab: 'overview', sel: { workout: null, diet: null, protocol: null } };

function ensureFeed(uid) {
  if (feed?.uid === uid) return;
  leaveAdminUser();
  ui.tab = 'overview';
  ui.sel = { workout: null, diet: null, protocol: null };
  feed = {
    uid,
    unsubs: [
      watchUserData(uid, (d) => { data = d; rerender(); }),
      watchUserInbox(uid, (items) => { inbox = items; rerender(); }),
    ],
  };
}

export function leaveAdminUser() {
  feed?.unsubs.forEach((u) => u());
  feed = null;
  data = null;
  inbox = [];
}

const profilesOf = (cat) => data?.profiles?.[cat]?.list || [];
const activeOf = (cat) => data?.profiles?.[cat]?.active || profilesOf(cat)[0]?.id || null;

// ── Envoi d'un programme / diet / protocole ─────────────────────────────

/** Copie avec de NOUVEAUX ids d'exercices (aucune collision chez l'utilisateur). */
function freshIds(cat, payload) {
  const d = NORMALIZE[cat](structuredClone(payload));
  if (cat === 'workout') for (const s of d.sessions) for (const e of s.exercises) e.id = newId('e');
  return d;
}

async function sendFlow(user, cat) {
  // 1. Source : un de MES profils, ou un code collé.
  const mine = state.profiles[cat]?.list || [];
  const source = await new Promise((resolve) => {
    actionSheet({
      title: T`Envoyer un ${CAT_LABEL[cat].toLowerCase()}`,
      subtitle: `à ${user.displayName || user.email}`,
      actions: [
        ...librarySources(cat).map((x) => ({ label: T`Bibliothèque · ${x.name}`, icon: 'book', onClick: () => resolve({ name: x.name, payload: x.payload }) })),
        ...mine.map((p) => ({ label: p.name, icon: 'file', onClick: () => resolve({ name: p.name, payload: profileData(cat, p.id) }) })),
        { label: 'Coller un code AnabolicOS…', icon: 'copy', onClick: async () => {
          const r = await formSheet({
            title: 'Coller un code', fields: [{ name: 'code', label: 'Code JSON', type: 'textarea', maxlength: 900000, required: true }],
            submitLabel: 'Analyser',
          });
          if (!r?.values) return resolve(null);
          try {
            const { bundle } = parseImport(r.values.code);
            if (!bundle[cat]) throw new Error(T`Ce code ne contient pas de ${CAT_LABEL[cat].toLowerCase()}.`);
            resolve({ name: bundle.name || CAT_LABEL[cat], payload: bundle[cat] });
          } catch (err) { toast(err.message, { type: 'error' }); resolve(null); }
        } },
      ],
    });
    if (!mine.length && !librarySources(cat).length) toast(T`Tu n'as aucun ${CAT_LABEL[cat].toLowerCase()} à toi : colle un code ou crée-en un dans ton propre onglet.`);
  });
  if (!source) return;

  // 2. Titre et message.
  const r = await formSheet({
    title: 'Détails de l’envoi',
    fields: [
      { name: 'title', label: 'Nom affiché', value: source.name, required: true, maxlength: 60 },
      { name: 'message', label: 'Message (optionnel)', type: 'textarea', maxlength: 500, placeholder: 'Ex. On passe sur 4 séances, garde les mêmes charges.' },
    ],
    submitLabel: 'Continuer',
  });
  if (!r?.values) return;
  const payload = freshIds(cat, source.payload);

  // 3. Mode : proposer ou installer.
  actionSheet({
    title: r.values.title,
    subtitle: 'Comment veux-tu l’envoyer ?',
    actions: [
      { label: 'Proposer (il accepte depuis son accueil)', icon: 'message', onClick: async () => {
        await proposeToUser(user.id, { type: cat, title: r.values.title, message: r.values.message, payload });
        toast('Envoi proposé');
      } },
      { label: 'Installer et activer maintenant', icon: 'download', onClick: async () => {
        await installProfileForUser(user.id, data.profiles, cat, r.values.title, payload);
        toast(T`${CAT_LABEL[cat]} installé chez ${user.displayName || 'l’utilisateur'}`);
      } },
    ],
  });
}

// ── Gestion d'un profil de l'utilisateur ────────────────────────────────

function manageProfile(user, cat, prof) {
  const isActive = activeOf(cat) === prof.id;
  actionSheet({
    title: prof.name,
    subtitle: T`${CAT_LABEL[cat]} de ${user.displayName || user.email}`,
    actions: [
      !isActive && { label: 'Rendre actif', icon: 'check', onClick: () => setUserActiveProfile(user.id, data.profiles, cat, prof.id) },
      { label: 'Renommer', icon: 'edit', onClick: async () => {
        const r = await formSheet({ title: 'Renommer', fields: [{ name: 'name', label: 'Nom', value: prof.name, required: true, maxlength: 60 }] });
        if (r?.values) renameUserProfile(user.id, data.profiles, cat, prof.id, r.values.name);
      } },
      { label: 'Supprimer', icon: 'trash', danger: true, onClick: async () => {
        const ok = await confirmSheet({ title: T`Supprimer « ${prof.name} » ?`, message: 'Le profil sera supprimé chez l’utilisateur. Action irréversible.' });
        if (ok) { await deleteUserProfile(user.id, data.profiles, cat, prof.id); toast('Profil supprimé'); }
      } },
    ],
  });
}

function ProfileChips(user, cat) {
  const profs = profilesOf(cat);
  if (!profs.some((p) => p.id === ui.sel[cat])) ui.sel[cat] = activeOf(cat);
  return h('div', { class: 'profile-bar' },
    h('div', { class: 'chips' }, profs.map((p) => h('button', {
      class: `chip${ui.sel[cat] === p.id ? ' chip--on' : ''}`, type: 'button',
      onclick: () => { ui.sel[cat] = p.id; rerender(); },
    }, p.name, activeOf(cat) === p.id ? ' ·  actif' : ''))),
    ui.sel[cat] ? IconButton('more', 'Gérer ce profil', () => manageProfile(user, cat, profs.find((p) => p.id === ui.sel[cat])), 'icon-btn--soft') : null);
}

const NoData = (cat, user) => Empty({
  iconName: { workout: 'dumbbell', diet: 'leaf', protocol: 'pill' }[cat],
  title: T`Aucun ${CAT_LABEL[cat].toLowerCase()}`,
  text: 'Tu peux lui en envoyer un.',
  actionLabel: T`Envoyer un ${CAT_LABEL[cat].toLowerCase()}`,
  onAction: () => sendFlow(user, cat),
});

// ── Onglets de la fiche ─────────────────────────────────────────────────

function OverviewTab(user) {
  const ws = weightStats(data.weights);
  const doneSessions = Object.entries(data.week).filter(([k, v]) => k.includes('_sess_') && v?.done).length;
  const ppid = activeOf('protocol');
  const items = (data.protocol?.[ppid]?.days || []).flatMap((d) => (d.injections || []).map((i) => ({ d, i })));
  const itemsDone = items.filter(({ d, i }) => data.week[itemKey(ppid, d, i)]?.done).length;

  return [
    h('div', { class: 'stats stats--4' },
      Stat(ws ? frNum(ws.last.kg) : '—', 'Poids (kg)'),
      Stat(ws?.delta7 != null ? `${ws.delta7 > 0 ? '+' : ''}${frNum(ws.delta7)}` : '—', '7 jours', ws?.delta7 > 0 ? 'up' : ws?.delta7 < 0 ? 'down' : ''),
      Stat(doneSessions, 'Séances sem.'),
      Stat((data.counterBase || 0) + doneSessions, 'Total séances')),
    h('section', { class: 'card' },
      h('p', { class: 'eyebrow' }, 'Profils actifs'),
      h('ul', { class: 'kv' }, ['workout', 'diet', 'protocol'].map((cat) => {
        const p = profilesOf(cat).find((x) => x.id === activeOf(cat));
        return h('li', {}, h('span', {}, CAT_LABEL[cat]), h('strong', {}, p ? p.name : '—'));
      }), h('li', {}, h('span', {}, 'Protocole cette semaine'), h('strong', {}, items.length ? `${itemsDone} / ${items.length}` : '—')))),
    SectionTitle('Envois récents'),
    inbox.length
      ? h('section', { class: 'card card--flush' }, inbox.map((it) => h('div', { class: 'list__row' },
        h('span', { class: 'list__main' }, T`${CAT_LABEL[it.type] || 'Envoi'} · ${it.title}`),
        h('span', { class: `tag${it.status === 'accepted' ? ' tag--ok' : it.status === 'dismissed' ? '' : ' tag--pending'}` },
          { pending: 'En attente', accepted: 'Accepté', dismissed: 'Ignoré' }[it.status] || it.status),
        it.status === 'pending' ? IconButton('x', 'Annuler cet envoi', () => cancelProposal(user.id, it.id), 'icon-btn--ghost') : null)))
      : h('p', { class: 'hint' }, 'Aucun envoi pour le moment.'),
  ];
}

function WeightTab() {
  const log = data.weights;
  if (!log.length) return [Empty({ iconName: 'scale', title: 'Aucune pesée', text: "L'utilisateur n'a pas encore saisi de poids." })];
  return [
    h('section', { class: 'card' },
      h('p', { class: 'eyebrow' }, T`Courbe · ${Math.min(60, log.length)} dernières pesées`),
      h('div', { class: 'chart-wrap' }, lineChart(log.slice(-60).map((e) => ({ label: formatShortDate(e.date, { day: 'numeric', month: 'short' }), value: e.kg })), { unit: ' kg' }))),
    h('section', { class: 'card card--flush' }, [...log].reverse().slice(0, 60).map((e) => h('div', { class: 'list__row' },
      h('span', { class: 'list__meta list__meta--date' }, formatShortDate(e.date)),
      h('span', { class: 'list__main' }, `${frNum(e.kg)} kg`)))),
  ];
}

function WorkoutTab(user) {
  if (!profilesOf('workout').length) return [NoData('workout', user)];
  const pid = ui.sel.workout || activeOf('workout');
  const sessions = data.workouts?.[pid]?.sessions || [];
  return [
    ProfileChips(user, 'workout'),
    sessions.length ? sessions.map((s) => {
      const done = data.week[`${pid}_sess_${s.id}`]?.done;
      return h('section', { class: 'card card--flush' },
        h('header', { class: 'meal__head' },
          h('div', {}, h('h3', { class: 'meal__name' }, s.name),
            h('span', { class: 'meal__kcal' }, [formatWeekdays(s.weekdays), T`${(s.exercises || []).length} exercices`].filter(Boolean).join(' · '))),
          done ? h('span', { class: 'tag tag--ok' }, 'Faite cette semaine') : null),
        (s.exercises || []).map((e) => {
          const last = data.exlogs[e.id]?.at(-1);
          return h('div', { class: 'food' },
            h('span', { class: 'food__body' },
              h('span', { class: 'food__name' }, e.n),
              h('span', { class: 'food__meta' }, [e.s, e.r !== '—' ? T`repos ${e.r}` : null, e.no].filter(Boolean).join(' · '))),
            last ? h('span', { class: 'food__kcal', title: T`1RM estimé ${frNum(est1RM(last.w, last.r), 0)} kg` }, `${frNum(last.w, last.w % 1 ? 1 : 0)}×${last.r}`) : null);
        }));
    }) : h('p', { class: 'hint' }, 'Ce programme ne contient aucune séance.'),
  ];
}

function DietTab(user) {
  if (!profilesOf('diet').length) return [NoData('diet', user)];
  const d = { objective: 0, macros: {}, meals: [], ...(data.diet?.[ui.sel.diet || activeOf('diet')] || {}) };
  const t = dietTotals(d);
  return [
    ProfileChips(user, 'diet'),
    h('section', { class: 'card' },
      h('div', { class: 'kcal' }, h('span', { class: 'kcal__big' }, String(t.cal)), h('span', { class: 'kcal__unit' }, d.objective ? T` / ${d.objective} kcal` : ' kcal')),
      h('div', { class: 'macros' },
        MacroBar('Protéines', t.p, d.macros?.p || 0, 'p'),
        MacroBar('Glucides', t.g, d.macros?.g || 0, 'g'),
        MacroBar('Lipides', t.l, d.macros?.l || 0, 'l'))),
    (d.meals || []).map((m) => h('section', { class: 'card card--flush' },
      h('header', { class: 'meal__head' }, h('div', {}, h('h3', { class: 'meal__name' }, m.name),
        h('span', { class: 'meal__kcal' }, `${(m.foods || []).reduce((a, f) => a + (Number(f.cal) || 0), 0)} kcal`))),
      (m.foods || []).map((f) => h('div', { class: 'food' },
        h('span', { class: 'food__body' }, h('span', { class: 'food__name' }, f.name), h('span', { class: 'food__meta' }, f.qty || '')),
        h('span', { class: 'food__kcal' }, String(f.cal || 0)))),
      SupplementList(m))),
  ];
}

function ProtocolTab(user) {
  if (!profilesOf('protocol').length) return [NoData('protocol', user)];
  const pid = ui.sel.protocol || activeOf('protocol');
  const days = data.protocol?.[pid]?.days || [];
  const today = isoWeekday();
  return [
    ProfileChips(user, 'protocol'),
    days.map((d) => {
      const wd = effectiveWeekdays(d);
      return h('section', { class: `card card--flush${wd.includes(today) ? ' card--today' : ''}` },
        h('header', { class: 'meal__head' }, h('div', {}, h('h3', { class: 'meal__name' }, d.name),
          h('span', { class: 'meal__kcal' }, [d.label, formatWeekdays(wd)].filter(Boolean).join(' · ')))),
        (d.injections || []).map((i) => {
          const on = data.week[itemKey(pid, d, i)]?.done;
          return h('div', { class: `check-item${on ? ' check-item--on' : ''}` },
            h('div', { class: 'check-item__toggle' },
              h('span', { class: 'check-item__box' }, icon('check', 16)),
              h('span', { class: 'check-item__body' }, h('span', { class: 'check-item__name' }, i.name), i.type ? h('span', { class: 'check-item__meta' }, i.type) : null),
              i.time ? h('span', { class: 'check-item__time' }, i.time) : null));
        }));
    }),
  ];
}

/** Objectifs de l'utilisateur : consultables et modifiables par l'admin. */
function GoalsTab(user) {
  const uid = user.id;
  const apply = (mutate) => {
    const g = structuredClone(data.goals);
    mutate(g);
    data.goals = g;          // affichage immédiat, le snapshot confirmera
    rerender();
    return setUserGoals(uid, g);
  };
  const toggle = (item) => apply((g) => {
    const key = periodKey(item.period);
    const cur = { ...(g.done[key] || {}) };
    if (cur[item.id]) delete cur[item.id]; else cur[item.id] = true;
    g.done[key] = cur;
  });
  const items = data.goals?.items || [];
  return [
    items.length
      ? GoalsBoard({ goals: data.goals, onToggle: toggle, onEdit: (it) => editGoal(it, apply), onAdd: (p) => editGoal(null, apply, p) })
      : Empty({ iconName: 'target', title: 'Aucun objectif', text: 'Fixe-lui des habitudes à cocher (pas, eau, sommeil, séances…).', actionLabel: 'Ajouter un objectif', onAction: () => editGoal(null, apply) }),
    items.length ? h('button', { class: 'btn btn--ghost btn--block add-btn', type: 'button', onclick: () => editGoal(null, apply) }, icon('plus', 18), 'Ajouter un objectif') : null,
    h('p', { class: 'hint' }, 'Les modifications apparaissent en direct chez l’utilisateur.'),
  ];
}

const TABS = [['overview', 'Aperçu'], ['weight', 'Poids'], ['workout', 'Séances'], ['diet', 'Diet'], ['protocol', 'Protocole'], ['goals', 'Objectifs']];

/** Renommer un utilisateur (son pseudo, visible partout dans l'app). */
async function renameFlow(uid, user) {
  const google = user.googleName || user.email || '';
  const r = await formSheet({
    title: 'Renommer',
    subtitle: T`Nom Google : ${google}. Le nouveau nom s’affiche partout (amis, profil, messages). Laisse vide pour revenir au nom Google.`,
    fields: [{ name: 'pseudo', label: 'Nom affiché', maxlength: 30, value: user.pseudo || '', placeholder: google }],
    submitLabel: 'Enregistrer',
  });
  if (!r?.values) return;
  try {
    const name = await renameUser(uid, r.values.pseudo);
    toast(T`Renommé : ${name}`);
  } catch (err) {
    console.error('[admin] renommer', err);
    toast(T`Renommage impossible : ${err.code || err.message}`, { type: 'error' });
  }
}

/** Suppression d'un compte : choix (réinscription possible ou bloquée), confirmation, puis suppression. */
function deleteAccountFlow(uid, user) {
  const who = user.displayName || user.email || 'cet utilisateur';
  const run = async (block) => {
    const ok = await confirmSheet({
      title: T`Supprimer ${who} ?`,
      message: T`Toutes ses données seront effacées définitivement (programmes, diet, protocole, poids, carnet, messages, amis, photo).${block ? ' Il ne pourra plus se réinscrire avec ce compte Google.' : ' S’il se reconnecte, il repartira de zéro.'} Action irréversible.`,
      confirmLabel: 'Supprimer définitivement',
    });
    if (!ok) return;
    toast('Suppression en cours…');
    try {
      const n = await deleteUserAccount(uid, { block });
      toast(T`Compte supprimé (${n} éléments effacés)`);
      location.hash = '#/admin';
    } catch (err) {
      console.error('[admin] suppression', err);
      toast(T`Suppression incomplète : ${err.code || err.message}. Réessaie.`, { type: 'error', duration: 7000 });
    }
  };
  actionSheet({
    title: 'Supprimer le compte',
    subtitle: who,
    actions: [
      { label: 'Supprimer (réinscription possible)', icon: 'trash', danger: true, onClick: () => run(false) },
      { label: 'Supprimer et bloquer ce compte Google', icon: 'x', danger: true, onClick: () => run(true) },
    ],
  });
}

export function AdminUserView(session, uid) {
  ensureAdminUsers();
  ensureFeed(uid);
  const user = (state.adminUsers || []).find((u) => u.id === uid);
  const header = PageHeader({
    eyebrow: 'Fiche utilisateur',
    title: user?.displayName || 'Utilisateur',
    trailing: IconButton('back', 'Retour aux utilisateurs', () => { location.hash = '#/admin'; }, 'icon-btn--soft'),
  });
  if (!user || !data?.ready) return [header, Skeleton(4)];

  const disabled = user.status === 'disabled';
  const isMe = uid === session.user.uid;
  const conv = (state.adminConversations || []).find((c) => c.id === uid);

  const body = {
    overview: OverviewTab, weight: WeightTab, workout: WorkoutTab, diet: DietTab, protocol: ProtocolTab, goals: GoalsTab,
  }[ui.tab](user);

  return [
    header,
    h('section', { class: 'card profile-card' },
      Avatar(user, 'avatar--lg'),
      h('div', { style: { minWidth: 0 } },
        h('p', { class: 'muted', style: { overflowWrap: 'anywhere' } }, user.email),
        h('p', { class: 'muted small' }, T`Inscrit ${ago(user.createdAt)} · actif ${ago(user.lastActiveAt)}`),
        disabled ? h('span', { class: 'tag tag--danger', style: { marginTop: '6px', display: 'inline-block' } }, 'Compte désactivé') : null)),
    h('div', { class: 'action-grid' },
      h('a', { class: 'action-tile', href: `#/admin/conv/${encodeURIComponent(uid)}` },
        icon('message', 22), h('span', {}, 'Message'), conv && unreadForAdmin(conv) ? h('span', { class: 'dot' }) : null),
      h('button', {
        class: 'action-tile', type: 'button',
        onclick: () => actionSheet({
          title: 'Envoyer', subtitle: `à ${user.displayName || user.email}`,
          actions: ['workout', 'diet', 'protocol'].map((cat) => ({ label: CAT_LABEL[cat], icon: { workout: 'dumbbell', diet: 'leaf', protocol: 'pill' }[cat], onClick: () => sendFlow(user, cat) })),
        }),
      }, icon('share', 22), h('span', {}, 'Envoyer')),
      h('button', {
        class: `action-tile${disabled ? '' : ' action-tile--danger'}`, type: 'button', disabled: isMe,
        title: isMe ? 'Tu ne peux pas désactiver ton propre compte' : null,
        onclick: async () => {
          const ok = await confirmSheet(disabled
            ? { title: 'Réactiver ce compte ?', message: "L'utilisateur retrouvera l'accès à toutes ses données.", confirmLabel: 'Réactiver', danger: false }
            : { title: 'Désactiver ce compte ?', message: "L'utilisateur ne pourra plus accéder à l'app. Ses données sont conservées et le compte peut être réactivé.", confirmLabel: 'Désactiver' });
          if (ok) { await setUserStatus(uid, disabled ? 'active' : 'disabled'); toast(disabled ? 'Compte réactivé' : 'Compte désactivé'); }
        },
      }, icon(disabled ? 'check' : 'x', 22), h('span', {}, disabled ? 'Réactiver' : 'Désactiver'))),
    h('button', { class: 'btn btn--ghost btn--block', type: 'button', onclick: () => renameFlow(uid, user) }, icon('edit', 18), 'Renommer'),
    isMe ? null : h('button', {
      class: 'btn btn--danger-quiet btn--block', type: 'button',
      onclick: () => deleteAccountFlow(uid, user),
    }, icon('trash', 18), 'Supprimer le compte'),
    h('div', { class: 'segmented segmented--compact', role: 'tablist' }, TABS.map(([key, label]) => h('button', {
      class: `segment${ui.tab === key ? ' segment--on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(ui.tab === key),
      onclick: () => { ui.tab = key; rerender(); },
    }, label))),
    body,
  ];
}
