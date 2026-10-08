/**
 * ADMIN — bibliothèque de programmes types.
 *
 *  • modèles intégrés (prêts à l'emploi, non modifiables) ;
 *  • modèles de l'admin, stockés dans library/{id} (lecture/écriture : admin seul) ;
 *  • envoi en un tap à un ou plusieurs utilisateurs : proposé (il accepte depuis
 *    son accueil) ou installé directement.
 */
import { h } from '../lib/dom.js';
import { uid as newId } from '../lib/ids.js';
import { parseImport, normalizeWorkout, normalizeDiet, normalizeProtocol } from '../lib/schema.js';
import { state, profileData, ensureAdminUsers } from '../store.js';
import { createProfile } from '../data/repo.js';
import { watchLibrary, saveLibraryItem, deleteLibraryItem, proposeToUser, installForUser } from '../data/admin.js';
import { PageHeader, IconButton, Empty, Skeleton, SectionTitle } from '../ui/layout.js';
import { formSheet, confirmSheet, actionSheet, openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { Avatar } from '../ui/avatar.js';

import { T } from '../lib/i18n.js';
const CAT_LABEL = { workout: 'Programme', diet: 'Diet', protocol: 'Protocole' };
const CAT_ICON = { workout: 'dumbbell', diet: 'leaf', protocol: 'pill' };
const NORMALIZE = { workout: normalizeWorkout, diet: normalizeDiet, protocol: normalizeProtocol };
const rerender = () => window.dispatchEvent(new Event('app:render'));

// ── Modèles intégrés ────────────────────────────────────────────────────

const ex = (n, s, r, no = '') => ({ id: newId('e'), n, s, r, no });
const ses = (name, weekdays, exercises) => ({ id: newId('ses'), name, weekdays, exercises });

const BUILTINS = [
  {
    id: 'builtin-fullbody-3', cat: 'workout', builtin: true, name: 'Full Body · 3 jours',
    note: 'Débutant / reprise. Lun-Mer-Ven, double progression.',
    payload: () => ({ sessions: [
      ses('Full A', [1], [ex('Squat barre', '4×6–8', "2'30"), ex('Développé couché barre', '4×6–8', "2'30"), ex('Rowing barre', '3×8–10', "2'"), ex('Développé militaire haltères', '3×10–12', "1'30"), ex('Curl haltères', '2×12–15', "1'")]),
      ses('Full B', [3], [ex('Soulevé de terre roumain', '4×8–10', "2'30"), ex('Développé incliné haltères', '3×8–10', "2'"), ex('Tirage vertical', '3×10–12', "1'30"), ex('Fentes marchées', '3×10–12', "1'30"), ex('Extension triceps poulie', '2×12–15', "1'")]),
      ses('Full C', [5], [ex('Presse à cuisses', '4×10–12', "2'"), ex('Dips', '3×8–12', "2'"), ex('Rowing haltère un bras', '3×10–12', "1'30"), ex('Élévations latérales', '3×12–15', "1'"), ex('Gainage', '3×45 s', "1'")]),
    ] }),
  },
  {
    id: 'builtin-upperlower-4', cat: 'workout', builtin: true, name: 'Upper / Lower · 4 jours',
    note: 'Intermédiaire. Lun-Mar / Jeu-Ven, force + volume.',
    payload: () => ({ sessions: [
      ses('Upper force', [1], [ex('Développé couché barre', '4×5–6', "3'"), ex('Rowing barre', '4×6–8', "2'30"), ex('Développé militaire barre', '3×6–8', "2'30"), ex('Tractions', '3×6–10', "2'"), ex('Curl barre', '3×8–10', "1'30"), { ...ex('Barre au front', '3×8–10', "1'30"), ss: true }]),
      ses('Lower force', [2], [ex('Squat barre', '4×5–6', "3'"), ex('Soulevé de terre roumain', '3×6–8', "2'30"), ex('Presse à cuisses', '3×10–12', "2'"), ex('Leg curl', '3×10–12', "1'30"), ex('Mollets debout', '4×10–15', "1'")]),
      ses('Upper volume', [4], [ex('Développé incliné haltères', '4×8–10', "2'"), ex('Tirage horizontal', '4×10–12', "1'30"), ex('Élévations latérales', '4×12–15', "1'"), { ...ex('Oiseau haltères', '3×12–15', "1'"), ss: true }, ex('Curl incliné', '3×10–12', "1'"), { ...ex('Extension triceps poulie', '3×12–15', "1'"), ss: true }]),
      ses('Lower volume', [5], [ex('Hack squat', '4×8–10', "2'"), ex('Hip thrust', '4×8–12', "2'"), ex('Fentes bulgares', '3×10–12', "1'30"), ex('Leg extension', '3×12–15', "1'"), { ...ex('Leg curl assis', '3×12–15', "1'"), ss: true }, ex('Mollets assis', '4×12–15', "1'")]),
    ] }),
  },
  {
    id: 'builtin-ppl-6', cat: 'workout', builtin: true, name: 'Push / Pull / Legs · 6 jours',
    note: 'Avancé. PPL ×2 du lundi au samedi.',
    payload: () => {
      const push = (d, n) => ses(T`Push ${n}`, [d], [ex('Développé couché barre', '4×6–8', "2'30"), ex('Développé incliné haltères', '3×8–10', "2'"), ex('Développé militaire haltères', '3×8–10', "2'"), ex('Élévations latérales', '4×12–15', "1'"), ex('Dips', '3×8–12', "1'30"), { ...ex('Extension triceps poulie', '3×12–15', "1'"), ss: true }]);
      const pull = (d, n) => ses(T`Pull ${n}`, [d], [ex('Tractions lestées', '4×6–8', "2'30"), ex('Rowing barre', '4×8–10', "2'"), ex('Tirage horizontal', '3×10–12', "1'30"), ex('Face pull', '3×12–15', "1'"), ex('Curl barre', '3×8–10', "1'30"), { ...ex('Curl marteau', '3×10–12', "1'"), ss: true }]);
      const legs = (d, n) => ses(T`Legs ${n}`, [d], [ex('Squat barre', '4×6–8', "3'"), ex('Soulevé de terre roumain', '3×8–10', "2'30"), ex('Presse à cuisses', '3×10–12', "2'"), ex('Leg curl', '3×10–12', "1'30"), { ...ex('Leg extension', '3×12–15', "1'"), ss: true }, ex('Mollets debout', '4×10–15', "1'")]);
      return { sessions: [push(1, 'A'), pull(2, 'A'), legs(3, 'A'), push(4, 'B'), pull(5, 'B'), legs(6, 'B')] };
    },
  },
];

// ── Données ─────────────────────────────────────────────────────────────

let items = null;
let unsub = null;
const ui = { cat: 'workout' };

function ensureFeed() {
  if (unsub) return;
  unsub = watchLibrary((list) => { items = list; rerender(); });
}

/** Sources disponibles pour « Envoyer » (fiche utilisateur). */
export function librarySources(cat) {
  ensureFeed();
  const mine = (items || []).filter((x) => x.cat === cat && x.payload);
  const builtins = BUILTINS.filter((x) => x.cat === cat).map((x) => ({ ...x, payload: x.payload() }));
  return [...mine, ...builtins];
}

const payloadOf = (item) => (typeof item.payload === 'function' ? item.payload() : structuredClone(item.payload));

/** Copie propre pour un utilisateur : normalisée + nouveaux ids d'exercices. */
function freshCopy(cat, payload) {
  const d = NORMALIZE[cat](payload);
  if (cat === 'workout') for (const s of d.sessions) for (const e of s.exercises) e.id = newId('e');
  return d;
}

function summary(cat, p) {
  if (!p) return '';
  if (cat === 'workout') {
    const n = (p.sessions || []).reduce((a, s) => a + (s.exercises || []).length, 0);
    return T`${(p.sessions || []).length} séance(s) · ${n} exercice(s)`;
  }
  if (cat === 'diet') return T`${(p.meals || []).length} repas${p.objective ? T` · ${p.objective} kcal` : ''}`;
  return T`${(p.days || []).reduce((a, d) => a + (d.injections || []).length, 0)} produit(s)`;
}

// ── Actions ─────────────────────────────────────────────────────────────

/** Ajout d'un modèle : depuis un de mes profils ou un code collé. */
async function addFlow(cat) {
  const mine = state.profiles[cat]?.list || [];
  const source = await new Promise((resolve) => {
    actionSheet({
      title: T`Nouveau modèle · ${CAT_LABEL[cat]}`,
      actions: [
        ...mine.map((p) => ({ label: T`Depuis « ${p.name} »`, icon: 'file', onClick: () => resolve({ name: p.name, payload: profileData(cat, p.id) }) })),
        { label: 'Coller un code AnabolicOS…', icon: 'copy', onClick: async () => {
          const r = await formSheet({ title: 'Coller un code', fields: [{ name: 'code', label: 'Code JSON', type: 'textarea', maxlength: 900000, required: true }], submitLabel: 'Analyser' });
          if (!r?.values) return resolve(null);
          try {
            const { bundle } = parseImport(r.values.code);
            if (!bundle[cat]) throw new Error(T`Ce code ne contient pas de ${CAT_LABEL[cat].toLowerCase()}.`);
            resolve({ name: bundle.name || CAT_LABEL[cat], payload: bundle[cat] });
          } catch (err) { toast(err.message, { type: 'error' }); resolve(null); }
        } },
      ],
    });
  });
  if (!source) return;
  const r = await formSheet({
    title: 'Nom du modèle',
    fields: [
      { name: 'name', label: 'Nom', value: source.name, required: true, maxlength: 60 },
      { name: 'note', label: 'Description (optionnel)', type: 'textarea', maxlength: 300, placeholder: 'Niveau, objectif, fréquence…' },
    ],
    submitLabel: 'Ajouter à la bibliothèque',
  });
  if (!r?.values) return;
  await saveLibraryItem(null, { cat, name: r.values.name, note: r.values.note, payload: NORMALIZE[cat](structuredClone(source.payload)) });
  toast('Modèle ajouté');
}

/** Choix des destinataires puis envoi (proposition ou installation). */
export function sendSheet(item) {
  const users = (state.adminUsers || []).filter((u) => u.status !== 'disabled');
  const picked = new Set();
  const count = h('span', {}, '0');
  const buttons = [];
  const refresh = () => {
    count.textContent = String(picked.size);
    for (const b of buttons) b.disabled = picked.size === 0;
  };

  const send = async (mode) => {
    sheet.close();
    const list = users.filter((u) => picked.has(u.id));
    let ok = 0;
    for (const u of list) {
      const payload = freshCopy(item.cat, payloadOf(item));
      try {
        if (mode === 'install') await installForUser(u.id, item.cat, item.name, payload);
        else await proposeToUser(u.id, { type: item.cat, title: item.name, message: item.note || '', payload });
        ok += 1;
      } catch { /* toast déjà affiché */ }
    }
    if (ok) toast(T`${mode === 'install' ? 'Installé' : 'Proposé'} à ${ok} utilisateur${ok > 1 ? 's' : ''}`);
  };

  const propose = h('button', { class: 'btn btn--primary btn--block', type: 'button', disabled: true, onclick: () => send('propose') },
    icon('message', 18), 'Proposer (', count, ')');
  const install = h('button', { class: 'btn btn--ghost btn--block', type: 'button', disabled: true, onclick: () => send('install') },
    icon('download', 18), 'Installer et activer directement');
  buttons.push(propose, install);

  const sheet = openSheet({
    title: T`Envoyer « ${item.name} »`,
    subtitle: 'Choisis les destinataires. « Proposer » : ils acceptent depuis leur accueil.',
    body: h('div', { class: 'send-sheet' },
      users.length
        ? h('div', { class: 'pick-list' }, users.map((u) => {
          const cb = h('input', { type: 'checkbox', class: 'sr-only', id: `pick-${u.id}` });
          const row = h('label', { class: 'pick', for: `pick-${u.id}` }, cb,
            Avatar({ uid: u.id, name: u.displayName || u.email, photoURL: u.photoURL, size: 'sm' }),
            h('span', { class: 'pick__name' }, u.displayName || u.email),
            h('span', { class: 'pick__box' }, icon('check', 14)));
          cb.addEventListener('change', () => { if (cb.checked) picked.add(u.id); else picked.delete(u.id); row.classList.toggle('pick--on', cb.checked); refresh(); });
          return row;
        }))
        : h('p', { class: 'muted' }, 'Aucun utilisateur actif.'),
      h('div', { class: 'form__actions' }, propose, install)),
  });
}

function itemMenu(item) {
  actionSheet({
    title: item.name,
    subtitle: summary(item.cat, payloadOf(item)),
    actions: [
      { label: 'Envoyer à…', icon: 'send', onClick: () => sendSheet(item) },
      { label: 'Ajouter à mes profils', icon: 'download', onClick: () => { createProfile(item.cat, item.name, freshCopy(item.cat, payloadOf(item))); toast('Ajouté à tes profils'); } },
      !item.builtin && { label: 'Renommer / description', icon: 'edit', onClick: async () => {
        const r = await formSheet({ title: 'Modifier le modèle', fields: [
          { name: 'name', label: 'Nom', value: item.name, required: true, maxlength: 60 },
          { name: 'note', label: 'Description', type: 'textarea', value: item.note, maxlength: 300 },
        ] });
        if (r?.values) saveLibraryItem(item.id, { cat: item.cat, name: r.values.name, note: r.values.note });
      } },
      !item.builtin && { label: 'Supprimer', icon: 'trash', danger: true, onClick: async () => {
        if (await confirmSheet({ title: T`Supprimer « ${item.name} » ?`, message: 'Les utilisateurs qui l’ont déjà reçu le gardent.' })) deleteLibraryItem(item.id);
      } },
    ],
  });
}

// ── Vue ─────────────────────────────────────────────────────────────────

function ItemCard(item) {
  return h('article', { class: 'card lib-item' },
    h('button', { class: 'lib-item__main', type: 'button', onclick: () => itemMenu(item) },
      h('span', { class: 'lib-item__icon' }, icon(CAT_ICON[item.cat], 20)),
      h('span', { class: 'lib-item__body' },
        h('span', { class: 'lib-item__name' }, item.name, item.builtin ? h('span', { class: 'badge badge--inline' }, 'Modèle') : null),
        h('span', { class: 'lib-item__meta' }, summary(item.cat, payloadOf(item))),
        item.note ? h('span', { class: 'lib-item__note' }, item.note) : null)),
    h('button', { class: 'btn btn--ink btn--sm lib-item__send', type: 'button', onclick: () => sendSheet(item) }, icon('send', 16), 'Envoyer'));
}

export function AdminLibraryView() {
  ensureFeed();
  ensureAdminUsers();   // destinataires des envois
  const header = PageHeader({
    eyebrow: 'Admin', title: 'Bibliothèque',
    trailing: IconButton('back', 'Retour', () => { location.hash = '#/admin'; }, 'icon-btn--soft'),
  });
  const cat = ui.cat;
  const mine = (items || []).filter((x) => x.cat === cat);
  const builtins = BUILTINS.filter((x) => x.cat === cat);

  return [
    header,
    h('div', { class: 'segmented segmented--fill segmented--compact', role: 'tablist' },
      Object.entries(CAT_LABEL).map(([k, l]) => h('button', {
        class: `segment${cat === k ? ' segment--on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(cat === k),
        onclick: () => { ui.cat = k; rerender(); },
      }, l))),
    SectionTitle('Mes modèles', h('button', { class: 'link-btn', type: 'button', onclick: () => addFlow(cat) }, icon('plus', 16), 'Ajouter')),
    items === null ? Skeleton(2)
      : mine.length ? h('div', { class: 'stack' }, mine.map(ItemCard))
        : Empty({ iconName: CAT_ICON[cat], title: 'Aucun modèle', text: 'Enregistre un de tes profils comme modèle pour l’envoyer en un tap.', actionLabel: 'Ajouter un modèle', onAction: () => addFlow(cat) }),
    builtins.length ? [SectionTitle('Modèles intégrés'), h('div', { class: 'stack' }, builtins.map(ItemCard))] : null,
    h('p', { class: 'hint' }, 'Chaque envoi est une copie indépendante : modifier un modèle ne change pas ce que les utilisateurs ont déjà reçu.'),
  ];
}
