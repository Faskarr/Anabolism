/**
 * Protocole, en deux parties :
 *  1. « Mes produits » : le catalogue (nom, dose, couleur) ;
 *  2. « Planning » : un tableau semaine (produits × L M M J V S D) où l'on
 *     place chaque prise à un jour et une heure, d'un tap.
 *
 * Stockage (compatible avec l'existant, l'accueil, l'admin et l'export) :
 *   { products: [{ id, name, dose, color }],
 *     days: [{ id, name, weekdays, auto, injections: [{ id, pid, name, type, time }] }] }
 * Chaque « prise » (injection) référence son produit (pid) et vit dans le groupe
 * de jours correspondant ; les groupes sont créés / supprimés automatiquement.
 */
import { h } from '../lib/dom.js';
import { uid } from '../lib/ids.js';
import { formatWeekdays, isoWeekday, localISODate, dayLetters } from '../lib/dates.js';
import { guessWeekdays } from '../lib/schema.js';
import { state, activeProfileId, profileData, injectionWeekKey } from '../store.js';
import { updateProfileData, setWeekItem, resetWeek } from '../data/repo.js';
import { PageHeader, ProfileBar, NoProfile, Empty, Skeleton, SectionTitle } from '../ui/layout.js';
import { parseTimeOfDay, formatMinutes } from '../lib/schedule.js';
import { formSheet, confirmSheet, actionSheet, openSheet } from '../ui/sheet.js';
import { undoToast, toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';

import { T, locale, tx } from '../lib/i18n.js';
const CAT = 'protocol';

/** Jours du protocole actif prévus aujourd'hui (pour l'accueil). */
export function todaysProtocolDays() {
  const today = isoWeekday();
  return (profileData(CAT)?.days || []).filter((d) => effectiveWeekdays(d).includes(today));
}

/** Jours explicites, sinon déduits du nom (« Lundi » → [1]). */
export function effectiveWeekdays(day) {
  return day.weekdays?.length ? day.weekdays : (guessWeekdays(day.name) || []);
}

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const sameDays = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Nom automatique d'un groupe de jours : « Tous les jours », « En semaine »… */
export function daysLabel(wd) {
  if (sameDays(wd, ALL_DAYS)) return 'Tous les jours';
  if (sameDays(wd, [1, 2, 3, 4, 5])) return 'En semaine';
  if (sameDays(wd, [6, 7])) return 'Week-end';
  return formatWeekdays(wd);
}

/** Heure lisible d'un produit (« Matin » → 08:00 ; défaut 09:00). */
const itemMinutes = (item, day) => parseTimeOfDay(item.time) ?? parseTimeOfDay(day?.label) ?? 9 * 60;

/** Supprime les groupes de jours devenus vides. */
function pruneAutoDays(d) {
  d.days = d.days.filter((x) => (x.injections || []).length);
}

// ── Rappels Calendrier ──────────────────────────────────────────────────

function remindersOf(days) {
  return days.flatMap((day) => (day.injections || []).map((it) => ({
    id: it.id, pid: it.pid, title: it.name, note: [it.type, 'AnabolicOS · protocole'].filter(Boolean).join(' — '),
    weekdays: effectiveWeekdays(day).length ? effectiveWeekdays(day) : ALL_DAYS,
    minutes: itemMinutes(it, day),
  })));
}

/** Panneau « Rappels » : ajout au Calendrier (tous ou un produit) + mode d'emploi pour les retirer. */
async function calendarSheet(days, only = null, productId = null) {
  const { buildICS, openICS, shareICS } = await import('../lib/ics.js');   // chargé à la demande
  const list = remindersOf(days).filter((x) => (!only || x.id === only.id) && (!productId || x.pid === productId));
  if (productId && list.length) only = { name: list[0].title };
  if (!list.length) { toast('Ajoute d’abord un produit.', { type: 'error' }); return; }
  const ics = buildICS(list);
  const name = only ? `anabolicos-${only.name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').slice(0, 30)}.ics` : 'anabolicos-rappels.ics';
  openSheet({
    title: only ? T`Rappel · ${only.name}` : 'Rappels dans Calendrier',
    subtitle: T`${list.length} rappel${list.length > 1 ? 's' : ''} récurrent${list.length > 1 ? 's' : ''}, avec alerte à l’heure de prise.`,
    body: h('div', { class: 'cal-sheet' },
      h('ul', { class: 'cal-list' }, list.map((x) => h('li', {},
        h('span', { class: 'cal-list__time' }, formatMinutes(x.minutes)),
        h('span', { class: 'cal-list__name' }, x.title),
        h('span', { class: 'cal-list__days' }, daysLabel(x.weekdays))))),
      h('div', { class: 'form__actions' },
        h('button', { class: 'btn btn--primary btn--block', type: 'button', onclick: () => openICS(ics, name) },
          icon('calendar', 18), 'Ajouter au Calendrier'),
        h('button', {
          class: 'btn btn--ghost btn--block', type: 'button',
          onclick: () => shareICS(ics, name).catch((err) => { if (err?.name !== 'AbortError') toast('Partage impossible.', { type: 'error' }); }),
        }, icon('share', 18), 'Partager le fichier')),
      h('div', { class: 'cal-help' },
        h('p', { class: 'cal-help__title' }, 'Ajouter'),
        h('p', {}, 'Touche « Ajouter au Calendrier », puis « Tout ajouter ». Conseil : choisis un calendrier dédié « AnabolicOS » (à créer dans l’app Calendrier › Calendriers › Ajouter).'),
        h('p', { class: 'cal-help__title' }, 'Modifier ou supprimer'),
        h('p', {}, 'Calendrier › touche un rappel › Supprimer l’événement › « Supprimer tous les événements futurs ». Pour tout retirer d’un coup : supprime le calendrier « AnabolicOS ».'),
        h('p', { class: 'muted small' }, 'Après une modification du protocole, supprime les anciens rappels avant de ré-ajouter, sinon ils seront en double.'))),
  });
}

/**
 * Clé de la case cochée d'un produit.
 *  • jour prévu une seule fois par semaine → clé hebdomadaire (format historique) ;
 *  • jour récurrent (ex. « Quotidien ») → clé par DATE, sinon une prise cochée
 *    lundi resterait cochée toute la semaine.
 */
export function itemKey(pid, day, item, date = localISODate()) {
  return effectiveWeekdays(day).length > 1
    ? `${injectionWeekKey(pid, item.id)}_${date}`
    : injectionWeekKey(pid, item.id);
}

/**
 * Ligne de produit, lisible d'un coup d'œil :  [ HEURE ]  Produit / dose  [ ✓ ]
 * La case coche/décoche ; un tap sur le texte ouvre l'édition (si onEdit),
 * sinon coche aussi. Réutilisée par l'accueil.
 */
export function ItemRow(pid, day, item, onEdit, timeText) {
  const key = itemKey(pid, day, item);
  const on = Boolean(state.week[key]?.done);
  const toggle = () => setWeekItem(key, { done: !on });
  const time = typeof timeText === 'string' ? timeText : (item.time || '');
  return h('div', { class: `pr-row${on ? ' pr-row--on' : ''}` },
    h('span', { class: `pr-row__time${time.length > 5 ? ' pr-row__time--word' : ''}` }, time || '—'),
    h('button', {
      class: 'pr-row__body', type: 'button',
      'aria-label': onEdit ? T`Modifier ${item.name}` : `${tx(on ? 'Décocher' : 'Cocher')} ${item.name}`,
      onclick: onEdit || toggle,
    },
    h('span', { class: 'pr-row__name' }, item.name),
    item.type ? h('span', { class: 'pr-row__dose' }, item.type) : null),
    h('button', {
      class: 'pr-check', type: 'button', 'aria-pressed': String(on), 'aria-label': `${tx(on ? 'Décocher' : 'Cocher')} ${item.name}`,
      onclick: toggle,
    }, icon('check', 18)));
}

const byTime = (a, b) => (parseTimeOfDay(a.i.time) ?? 9999) - (parseTimeOfDay(b.i.time) ?? 9999);

/** Bloc « Aujourd'hui » : toutes les prises du jour, triées par heure. */
function TodayCard(pid, days) {
  const today = isoWeekday();
  const items = days.filter((d) => effectiveWeekdays(d).includes(today))
    .flatMap((d) => (d.injections || []).map((i) => ({ d, i })))
    .sort(byTime);
  const done = items.filter(({ d, i }) => state.week[itemKey(pid, d, i)]?.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const dayName = new Date().toLocaleDateString(locale(), { weekday: 'long' });

  return h('section', { class: 'card proto-today' },
    h('div', { class: 'card__row' },
      h('div', {},
        h('p', { class: 'eyebrow' }, T`Aujourd’hui · ${dayName}`),
        h('p', { class: 'proto-today__count' }, items.length ? `${done}/${items.length}` : '—', h('span', {}, items.length ? ' pris' : ''))),
      items.length ? h('span', { class: `proto-today__pct${pct === 100 ? ' proto-today__pct--done' : ''}` }, pct === 100 ? 'Terminé ✓' : `${pct} %`) : null),
    items.length ? h('div', { class: 'bar' }, h('div', { class: 'bar__fill bar__fill--p', style: { width: `${pct}%` } })) : null,
    items.length
      ? h('div', { class: 'pr-list' }, items.map(({ d, i }) => ItemRow(pid, d, i)))
      : h('p', { class: 'muted', style: { marginTop: '8px' } }, 'Rien de prévu aujourd’hui.'));
}


// ── Produits ────────────────────────────────────────────────────────────

/** Couleurs des produits : lisibles en clair comme en sombre. */
const PALETTE = ['#9B2C3F', '#2F6F96', '#4E8A3A', '#C0711F', '#7350B5', '#1E8C82', '#B8476A', '#5B6575'];
const WD_LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

const colorOf = (p) => (/^#[0-9a-f]{6}$/i.test(p?.color || '') ? p.color : PALETTE[0]);
const tint = (p) => `--c:${colorOf(p)}`;
const norm = (x) => String(x || '').trim().toLowerCase();

/** Toutes les prises : [{ day, it }]. */
const entriesOf = (days) => days.flatMap((day) => (day.injections || []).map((it) => ({ day, it })));

/** Anciennes données (prises sans produit) → crée le catalogue et relie les prises. */
function needsMigration(data) {
  const ids = new Set((data.products || []).map((p) => p.id));
  return entriesOf(data.days || []).some(({ it }) => !ids.has(it.pid));
}
function migrate(d) {
  d.products = d.products || [];
  for (const { it } of entriesOf(d.days)) {
    if (d.products.some((p) => p.id === it.pid)) continue;
    let p = d.products.find((x) => norm(x.name) === norm(it.name) && norm(x.dose) === norm(it.type));
    if (!p) {
      p = { id: uid('prd'), name: it.name, dose: it.type || '', color: PALETTE[d.products.length % PALETTE.length] };
      d.products.push(p);
    }
    it.pid = p.id;
  }
}

/** Range une prise dans le groupe de jours correspondant (créé si besoin). */
function placeEntry(d, entry, weekdays) {
  const days = [...new Set(weekdays)].sort();
  for (const x of d.days) x.injections = (x.injections || []).filter((i) => i.id !== entry.id);
  if (days.length) {
    let target = d.days.find((x) => sameDays(effectiveWeekdays(x), days));
    if (!target) {
      target = { id: uid('day'), name: daysLabel(days), label: '', weekdays: days, auto: true, injections: [] };
      d.days.push(target);
    }
    target.injections.push(entry);
  }
  pruneAutoDays(d);
}

const findEntry = (d, id) => entriesOf(d.days).find(({ it }) => it.id === id);

/** Ajoute / modifie une prise : produit, heure, jours. */
function saveEntry({ id, pid, time, weekdays }) {
  return updateProfileData(CAT, (d) => {
    const p = (d.products || []).find((x) => x.id === pid);
    if (!p) return;
    const cur = id && findEntry(d, id);
    const entry = { id: cur?.it.id || uid('inj'), pid, name: p.name, type: p.dose || '', time };
    placeEntry(d, entry, weekdays);
  });
}

/**
 * Une ou plusieurs heures, mêmes jours, en une seule écriture : la 1re heure
 * met à jour la prise modifiée (si `id`), les suivantes créent de nouvelles prises.
 */
function saveEntries({ id, pid, times, weekdays }) {
  return updateProfileData(CAT, (d) => {
    const p = (d.products || []).find((x) => x.id === pid);
    if (!p) return;
    times.forEach((time, i) => {
      const cur = i === 0 && id ? findEntry(d, id) : null;
      const entry = { id: cur?.it.id || uid('inj'), pid, name: p.name, type: p.dose || '', time };
      placeEntry(d, entry, weekdays);
    });
  });
}

/** Retire un jour d'une prise (la prise disparaît s'il ne reste aucun jour). */
function removeDay(entryId, wd) {
  return updateProfileData(CAT, (d) => {
    const e = findEntry(d, entryId);
    if (!e) return;
    placeEntry(d, e.it, effectiveWeekdays(e.day).filter((x) => x !== wd));
  });
}

async function deleteProduct(product) {
  const ok = await confirmSheet({ title: T`Supprimer « ${product.name} » ?`, message: 'Le produit et toutes ses prises du planning seront supprimés.' });
  if (!ok) return;
  const undo = updateProfileData(CAT, (d) => {
    d.products = (d.products || []).filter((x) => x.id !== product.id);
    for (const x of d.days) x.injections = (x.injections || []).filter((i) => i.pid !== product.id);
    pruneAutoDays(d);
  });
  undoToast(T`« ${product.name} » supprimé`, undo);
}

async function editProduct(product) {
  const r = await formSheet({
    title: product ? 'Modifier le produit' : 'Nouveau produit',
    fields: [
      { name: 'name', label: 'Produit', value: product?.name, required: true, maxlength: 120, placeholder: 'Créatine, Vitamine D3, Oméga 3…' },
      { name: 'dose', label: 'Dose', value: product?.dose, maxlength: 120, placeholder: '5 g, 2 gélules, 4000 UI…' },
    ],
    submitLabel: product ? 'Enregistrer' : 'Ajouter et planifier',
    deleteLabel: product ? 'Supprimer le produit' : null,
  });
  if (!r) return;
  if (r.action === 'delete') { deleteProduct(product); return; }
  const { name, dose } = r.values;
  if (product) {
    updateProfileData(CAT, (d) => {
      const p = d.products.find((x) => x.id === product.id);
      if (!p) return;
      Object.assign(p, { name, dose });
      // Les prises reprennent le nouveau nom / la nouvelle dose.
      for (const { it } of entriesOf(d.days)) if (it.pid === p.id) Object.assign(it, { name, type: dose });
    });
    return;
  }
  const id = uid('prd');
  updateProfileData(CAT, (d) => {
    d.products = d.products || [];
    d.products.push({ id, name, dose, color: PALETTE[d.products.length % PALETTE.length] });
  });
  // Enchaîne directement sur « quand le prendre ? ».
  setTimeout(() => editEntry({ pid: id }), 260);
}

/** Panneau « quand ? » : heure + jours d'une prise. */
async function editEntry({ pid, entry = null, day = null, presetDays = null }) {
  const products = profileData(CAT).products || [];
  const p = products.find((x) => x.id === pid);
  if (!p) return;
  const t = entry ? parseTimeOfDay(entry.time) ?? itemMinutes(entry, day) : null;
  const r = await formSheet({
    title: entry ? T`${p.name} · modifier la prise` : T`Quand prendre ${p.name} ?`,
    subtitle: p.dose || null,
    fields: [
      { name: 'times', type: 'times', label: entry ? 'Heure (+ autres prises)' : 'Heures de prise', value: [t != null ? formatMinutes(t) : '08:00'],
        hint: 'Plusieurs prises par jour ? « Ajouter une heure » (ex. 08:00 et 20:00).' },
      { name: 'weekdays', type: 'weekdays', label: 'Jours', value: presetDays || (day ? effectiveWeekdays(day) : ALL_DAYS),
        hint: 'Tous cochés = tous les jours.' },
    ],
    submitLabel: entry ? 'Enregistrer' : 'Ajouter au planning',
    deleteLabel: entry ? 'Supprimer cette prise' : null,
  });
  if (!r) return;
  if (r.action === 'delete') {
    const undo = updateProfileData(CAT, (d) => {
      for (const x of d.days) x.injections = (x.injections || []).filter((i) => i.id !== entry.id);
      pruneAutoDays(d);
    });
    undoToast('Prise supprimée', undo);
    return;
  }
  if (!r.values.weekdays.length) { toast('Choisis au moins un jour.', { type: 'error' }); return; }
  const times = r.values.times || [];
  if (!times.length) { toast('Indique au moins une heure.', { type: 'error' }); return; }
  saveEntries({ id: entry?.id, pid, times, weekdays: r.values.weekdays });
  if (times.length > 1) toast(T`${times.length} prises par jour : ${times.join(' · ')}`);
}

/** Tap sur une case du tableau (produit × jour). */
function onCell(p, wd, cellEntries, allEntries) {
  const dayName = WD_LONG[wd - 1];
  if (!cellEntries.length) {
    // Une seule prise pour ce produit : on lui ajoute ce jour directement.
    if (allEntries.length === 1) {
      const { day, it } = allEntries[0];
      saveEntry({ id: it.id, pid: p.id, time: it.time || formatMinutes(itemMinutes(it, day)), weekdays: [...effectiveWeekdays(day), wd] });
      toast(T`${p.name} ajouté le ${dayName}`);
      return;
    }
    if (!allEntries.length) { editEntry({ pid: p.id, presetDays: [wd] }); return; }
    actionSheet({
      title: T`${p.name} · ${dayName}`,
      subtitle: 'À quelle prise ajouter ce jour ?',
      actions: [
        ...allEntries.map(({ day, it }) => ({
          label: T`Prise de ${formatMinutes(itemMinutes(it, day))} · ${daysLabel(effectiveWeekdays(day))}`, icon: 'clock',
          onClick: () => saveEntry({ id: it.id, pid: p.id, time: it.time || formatMinutes(itemMinutes(it, day)), weekdays: [...effectiveWeekdays(day), wd] }),
        })),
        { label: 'Nouvelle heure…', icon: 'plus', onClick: () => editEntry({ pid: p.id, presetDays: [wd] }) },
      ],
    });
    return;
  }
  actionSheet({
    title: T`${p.name} · ${dayName}`,
    subtitle: p.dose || null,
    actions: [
      ...cellEntries.map(({ day, it }) => ({
        label: T`Retirer le ${dayName} (${formatMinutes(itemMinutes(it, day))})`, icon: 'x', danger: true,
        onClick: () => removeDay(it.id, wd),
      })),
      ...cellEntries.map(({ day, it }) => ({
        label: T`Modifier la prise de ${formatMinutes(itemMinutes(it, day))}`, icon: 'edit',
        onClick: () => editEntry({ pid: p.id, entry: it, day }),
      })),
      { label: T`Ajouter une autre heure le ${dayName}`, icon: 'plus', onClick: () => editEntry({ pid: p.id, presetDays: [wd] }) },
    ],
  });
}

// ── Affichage ───────────────────────────────────────────────────────────

/** Tableau de la semaine : une ligne par produit, une colonne par jour. */
function PlanningTable(products, days) {
  const today = isoWeekday();
  const all = entriesOf(days);
  return h('section', { class: 'card card--flush plan', 'aria-label': 'Planning de la semaine' },
    h('div', { class: 'plan__row plan__row--head' },
      h('span', { class: 'plan__corner' }, 'Produit'),
      dayLetters().map((l, i) => h('span', { class: `plan__wd${i + 1 === today ? ' plan__wd--today' : ''}`, 'aria-label': WD_LONG[i] }, l))),
    products.map((p) => {
      const mine = all.filter(({ it }) => it.pid === p.id);
      return h('div', { class: 'plan__row', style: tint(p) },
        h('button', { class: 'plan__name', type: 'button', onclick: () => productMenu(p, days) },
          h('span', { class: 'plan__dot' }),
          h('span', { class: 'plan__label' }, h('span', { class: 'plan__pname' }, p.name), p.dose ? h('span', { class: 'plan__dose' }, p.dose) : null)),
        ALL_DAYS.map((wd) => {
          const cell = mine.filter(({ day }) => effectiveWeekdays(day).includes(wd))
            .sort((a, b) => itemMinutes(a.it, a.day) - itemMinutes(b.it, b.day));
          return h('button', {
            class: `plan__cell${cell.length ? ' plan__cell--on' : ''}${wd === today ? ' plan__cell--today' : ''}`, type: 'button',
            'aria-label': T`${p.name}, ${WD_LONG[wd - 1]} : ${cell.length ? cell.map(({ it, day }) => formatMinutes(itemMinutes(it, day))).join(', ') : 'rien'}`,
            onclick: () => onCell(p, wd, cell, mine),
          }, cell.length
            ? cell.slice(0, 2).map(({ it, day }) => h('span', { class: 'plan__time' }, formatMinutes(itemMinutes(it, day))))
            : h('span', { class: 'plan__plus', 'aria-hidden': 'true' }, '+'),
          cell.length > 2 ? h('span', { class: 'plan__more' }, `+${cell.length - 2}`) : null);
        }));
    }));
}

function productMenu(p, days) {
  const mine = entriesOf(days).filter(({ it }) => it.pid === p.id);
  actionSheet({
    title: p.name,
    subtitle: p.dose || null,
    actions: [
      { label: 'Ajouter une prise (heure + jours)', icon: 'plus', onClick: () => editEntry({ pid: p.id }) },
      ...mine.map(({ day, it }) => ({
        label: T`Modifier la prise de ${formatMinutes(itemMinutes(it, day))} · ${daysLabel(effectiveWeekdays(day))}`, icon: 'clock',
        onClick: () => editEntry({ pid: p.id, entry: it, day }),
      })),
      { label: 'Renommer / changer la dose', icon: 'edit', onClick: () => editProduct(p) },
      mine.length ? { label: 'Rappels dans Calendrier', icon: 'bell', onClick: () => calendarSheet(days, null, p.id) } : null,
      { label: 'Supprimer le produit', icon: 'trash', danger: true, onClick: () => deleteProduct(p) },
    ],
  });
}

/** Catalogue : un produit par carte, avec ses prises résumées. */
function ProductCards(products, days) {
  const all = entriesOf(days);
  return h('div', { class: 'pcards' }, products.map((p) => {
    const mine = all.filter(({ it }) => it.pid === p.id)
      .sort((a, b) => itemMinutes(a.it, a.day) - itemMinutes(b.it, b.day));
    return h('button', { class: 'pcard', type: 'button', style: tint(p), onclick: () => productMenu(p, days) },
      h('span', { class: 'pcard__bar' }),
      h('span', { class: 'pcard__body' },
        h('span', { class: 'pcard__name' }, p.name),
        p.dose ? h('span', { class: 'pcard__dose' }, p.dose) : null,
        h('span', { class: 'pcard__slots' }, mine.length
          ? mine.map(({ day, it }) => h('span', { class: 'pcard__slot' },
            h('strong', {}, formatMinutes(itemMinutes(it, day))), T` · ${daysLabel(effectiveWeekdays(day))}`))
          : h('span', { class: 'pcard__slot pcard__slot--none' }, 'Pas encore planifié — touche pour ajouter'))),
      icon('chevron', 18));
  }));
}

let migratedPid = null;

export function ProtocolView() {
  const days0 = activeProfileId(CAT) ? profileData(CAT).days || [] : [];
  const header = PageHeader({
    eyebrow: 'Planning', title: 'Mon protocole',
    trailing: entriesOf(days0).length
      ? h('button', { class: 'head-action', type: 'button', onclick: () => calendarSheet(days0), 'aria-label': 'Synchroniser le calendrier et les rappels' },
        icon('bell', 20), h('span', {}, 'Calendrier', h('br'), '& rappels'))
      : null,
  });
  if (!state.ready) return [header, Skeleton(4)];
  const pid = activeProfileId(CAT);
  if (!pid) return [header, NoProfile(CAT, 'pill')];

  const data = profileData(CAT);
  if (needsMigration(data)) {
    // Migration unique (hors du rendu), appliquée aux données reçues de Firestore.
    if (migratedPid !== pid) { migratedPid = pid; queueMicrotask(() => updateProfileData(CAT, migrate, pid)); }
    return [header, Skeleton(3)];
  }
  const products = data.products || [];
  const days = data.days || [];
  const planned = entriesOf(days).length;

  return [
    header,
    ProfileBar(CAT),
    planned ? TodayCard(pid, days) : null,

    SectionTitle('Mes produits', h('button', { class: 'link-btn', type: 'button', onclick: () => editProduct(null) }, icon('plus', 16), 'Ajouter')),
    products.length
      ? ProductCards(products, days)
      : Empty({ iconName: 'pill', title: 'Aucun produit', text: 'Ajoute tes compléments et produits (nom + dose), puis place-les dans ta semaine.', actionLabel: 'Ajouter un produit', onAction: () => editProduct(null) }),

    products.length ? [
      SectionTitle('Planning de la semaine'),
      PlanningTable(products, days),
      h('p', { class: 'hint' }, 'Touche une case pour ajouter le produit ce jour-là, ou pour retirer / changer l’heure. Touche un nom pour gérer toutes ses prises.'),
    ] : null,

    planned ? h('button', {
      class: 'btn btn--quiet btn--block', type: 'button',
      onclick: async () => {
        const ok = await confirmSheet({
          title: 'Réinitialiser la semaine ?',
          message: 'Décoche toutes les séances et tous les produits de la semaine en cours.',
          confirmLabel: 'Réinitialiser',
        });
        if (ok) undoToast('Semaine réinitialisée', resetWeek());
      },
    }, icon('reset', 18), 'Réinitialiser la semaine') : null,
  ];
}
