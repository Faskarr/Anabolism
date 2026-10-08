/**
 * Partage : export (un profil OU sauvegarde complète) et import (code ou fichier).
 *
 * Améliorations vs l'ancienne app :
 *  • on choisit QUEL profil exporter (plus seulement le profil actif) ;
 *  • sauvegarde complète = tous les profils + poids + carnet + compteur ;
 *  • export en fichier .json en plus du copier/partager ;
 *  • l'import montre d'abord ce que contient le code, avec « Poids » et
 *    « Compteur » décochés par défaut (corrige l'écrasement du poids).
 */
import { h } from '../lib/dom.js';
import { buildExport, parseImport } from '../lib/schema.js';
import { state, profileData, activeProfileId, ensureExlogs, isSynced } from '../store.js';
import { localISODate } from '../lib/dates.js';
import { applyImport } from '../data/importer.js';
import { PageHeader, SectionTitle, IconButton } from '../ui/layout.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { openSheet } from '../ui/sheet.js';
import { isAccepted, friendOf, sendFriendShares, SHARE_LABEL } from '../data/friends.js';

import { T, tx, locale } from '../lib/i18n.js';
const CAT_LABEL = { workout: 'Programme', diet: 'Diet', protocol: 'Protocole' };

// État local de l'écran (survit aux re-rendus déclenchés par le store).
const ui = { mode: 'profile', cat: 'workout', pid: null, importText: '', importName: '', parsed: null, pick: {}, error: null };

// ── Export ──────────────────────────────────────────────────────────────

function exportText() {
  if (ui.mode === 'all') {
    // La sauvegarde complète inclut le carnet de charges (chargé à la demande).
    if (!isSynced('exlogs')) { ensureExlogs(); toast('Chargement du carnet de charges… réessaie dans une seconde.'); return null; }
    const all = {};
    for (const cat of ['workout', 'diet', 'protocol']) {
      all[cat] = state.profiles[cat].list.map((p) => ({ name: p.name, data: profileData(cat, p.id) }));
    }
    return buildExport({ all, weights: state.weights, counterBase: state.counterBase, exlogs: state.exlogs, goals: state.goals });
  }
  const pid = ui.pid || activeProfileId(ui.cat);
  const prof = state.profiles[ui.cat].list.find((p) => p.id === pid);
  if (!prof) return null;
  return buildExport({ profiles: [{ cat: ui.cat, name: prof.name, data: profileData(ui.cat, pid) }] });
}

function fileName() {
  const date = localISODate();   // date locale (toISOString = UTC, la veille avant 2 h)
  if (ui.mode === 'all') return `anabolicos-sauvegarde-${date}.json`;
  const prof = state.profiles[ui.cat].list.find((p) => p.id === (ui.pid || activeProfileId(ui.cat)));
  const slug = (prof?.name || ui.cat).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `anabolicos-${slug || ui.cat}.json`;
}

async function doCopy() {
  const text = exportText();
  if (!text) return (ui.mode === 'all' ? null : toast('Aucun profil à exporter.', { type: 'error' }));
  try {
    await navigator.clipboard.writeText(text);
    toast('Code copié');
  } catch {
    toast('Copie impossible — utilise « Fichier ».', { type: 'error' });
  }
}

async function doShare() {
  const text = exportText();
  if (!text) return (ui.mode === 'all' ? null : toast('Aucun profil à exporter.', { type: 'error' }));
  const file = new File([text], fileName(), { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'AnabolicOS' });
    else if (navigator.share) await navigator.share({ title: 'AnabolicOS', text });
    else return doDownload();
  } catch (err) {
    if (err?.name !== 'AbortError') toast('Partage impossible.', { type: 'error' });
  }
}

function doDownload() {
  const text = exportText();
  if (!text) return (ui.mode === 'all' ? null : toast('Aucun profil à exporter.', { type: 'error' }));
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { download: fileName() });
  a.href = url;   // blob: posé directement (le filtre d'URL de h() le refuserait)
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function rerender() { window.dispatchEvent(new Event('app:render')); }

/**
 * Envoi à un ami : on coche ce qu'on veut (un ou plusieurs programmes, diets,
 * protocoles — ou tout), on choisit l'ami, et tout part en une fois dans votre
 * discussion. L'ami accepte ou refuse chaque élément.
 */
function sendToFriend() {
  const me = state.me?.uid;
  if (!me) return;
  const friends = state.friendships.filter(isAccepted)
    .map((f) => ({ f, name: f.names?.[friendOf(f, me)] || 'Ami' }));
  if (!friends.length) return toast('Ajoute d’abord un ami dans Contact (avec son code ami).', { type: 'error', duration: 5000 });

  const items = ['workout', 'diet', 'protocol'].flatMap((cat) =>
    state.profiles[cat].list.map((p) => ({ cat, pid: p.id, name: p.name, on: false })));
  if (!items.length) return toast('Aucun programme, diet ou protocole à envoyer.', { type: 'error' });
  let friend = friends.length === 1 ? friends[0] : null;

  const sendBtn = h('button', { class: 'btn btn--primary btn--block', type: 'button' }, icon('send', 18), 'Envoyer');
  const allCb = h('input', { type: 'checkbox' });
  const boxes = items.map((it) => {
    const cb = h('input', { type: 'checkbox' });
    cb.addEventListener('change', () => { it.on = cb.checked; sync(); });
    return { it, cb };
  });
  const friendBtns = friends.map((x) => {
    const b = h('button', { class: `chip${friend === x ? ' chip--on' : ''}`, type: 'button' }, x.name);
    b.addEventListener('click', () => { friend = x; friendBtns.forEach((o) => o.classList.toggle('chip--on', o === b)); sync(); });
    return b;
  });
  function sync() {
    const n = items.filter((x) => x.on).length;
    allCb.checked = n === items.length;
    sendBtn.disabled = !n || !friend;
    sendBtn.lastChild.textContent = n ? T`Envoyer ${n} élément${n > 1 ? 's' : ''}${friend ? T` à ${friend.name}` : ''}` : tx('Coche au moins un élément');
  }
  allCb.addEventListener('change', () => { boxes.forEach(({ it, cb }) => { it.on = allCb.checked; cb.checked = allCb.checked; }); sync(); });

  const groups = ['workout', 'diet', 'protocol'].map((cat) => {
    const list = boxes.filter((b) => b.it.cat === cat);
    if (!list.length) return null;
    return h('div', { class: 'send-group' },
      h('p', { class: 'eyebrow' }, { workout: 'Programmes', diet: 'Diets', protocol: 'Protocoles' }[cat]),
      list.map(({ it, cb }) => h('label', { class: 'checkbox' }, cb, h('span', {}, it.name))));
  });

  const sheet = openSheet({
    title: 'Envoyer à un ami',
    subtitle: 'Coche ce que tu veux envoyer. Ton ami accepte ou refuse chaque élément dans votre discussion.',
    body: h('div', { class: 'form' },
      friends.length > 1 ? h('div', {}, h('p', { class: 'eyebrow' }, 'À qui ?'), h('div', { class: 'chips chips--wrap' }, friendBtns)) : null,
      h('label', { class: 'checkbox checkbox--all' }, allCb, h('span', {}, 'Tout envoyer')),
      groups,
      h('div', { class: 'form__actions' }, sendBtn)),
  });

  sendBtn.addEventListener('click', async () => {
    const picked = items.filter((x) => x.on);
    if (!picked.length || !friend || sendBtn.dataset.busy) return;
    sendBtn.dataset.busy = '1';
    try {
      await sendFriendShares(me, friend.f.id, picked.map((x) => ({ cat: x.cat, title: x.name, data: profileData(x.cat, x.pid) })));
      sheet.close();
      const pid = friend.f.id;
      toast(`${picked.length > 1 ? T`${picked.length} éléments envoyés` : 'Envoyé'} à ${friend.name}`, { action: { label: 'Voir', onClick: () => { location.hash = `#/friends/${encodeURIComponent(pid)}`; } } });
    } catch (err) {
      console.error('[share]', err);
      toast(err.message?.includes('volumineux') ? err.message : 'Envoi impossible. Vérifie ta connexion.', { type: 'error', duration: 6000 });
    } finally { delete sendBtn.dataset.busy; }
  });
  sync();
}

function ExportCard() {
  const modeTabs = h('div', { class: 'segmented segmented--fill' },
    [['profile', 'Un profil'], ['all', 'Sauvegarde complète']].map(([m, l]) => h('button', {
      class: `segment${ui.mode === m ? ' segment--on' : ''}`, type: 'button',
      onclick: () => { ui.mode = m; rerender(); },
    }, l)));

  let picker = null;
  if (ui.mode === 'profile') {
    const list = state.profiles[ui.cat].list;
    if (!list.some((p) => p.id === ui.pid)) ui.pid = activeProfileId(ui.cat);
    picker = h('div', {},
      h('div', { class: 'chips chips--wrap' }, Object.entries(CAT_LABEL).map(([c, l]) => h('button', {
        class: `chip${ui.cat === c ? ' chip--on' : ''}`, type: 'button',
        onclick: () => { ui.cat = c; ui.pid = null; rerender(); },
      }, l))),
      list.length
        ? h('div', { class: 'chips chips--wrap', style: { marginTop: '8px' } }, list.map((p) => h('button', {
          class: `chip chip--outline${ui.pid === p.id ? ' chip--on' : ''}`, type: 'button',
          onclick: () => { ui.pid = p.id; rerender(); },
        }, p.name)))
        : h('p', { class: 'muted', style: { marginTop: '8px' } }, 'Aucun profil dans cette catégorie.'));
  } else {
    const n = ['workout', 'diet', 'protocol'].reduce((a, c) => a + state.profiles[c].list.length, 0);
    picker = h('p', { class: 'muted' },
      T`${n} profil(s), ${state.weights.length} pesée(s), carnet de charges et compteur. Idéal pour garder une copie de tes données.`);
  }

  return h('section', { class: 'card' },
    h('p', { class: 'eyebrow' }, 'Exporter'),
    modeTabs,
    picker,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn--ink', type: 'button', onclick: doShare }, icon('share', 18), 'Partager'),
      h('button', { class: 'btn btn--ghost', type: 'button', onclick: doCopy }, icon('copy', 18), 'Copier'),
      h('button', { class: 'btn btn--ghost', type: 'button', onclick: doDownload }, icon('download', 18), 'Fichier')));
}

// ── Import ──────────────────────────────────────────────────────────────

function analyse(text) {
  ui.importText = text;
  ui.error = null;
  ui.parsed = null;
  try {
    ui.parsed = parseImport(text);
    const b = ui.parsed.bundle;
    ui.pick = {
      workout: Boolean(b.workout), diet: Boolean(b.diet), protocol: Boolean(b.protocol),
      all: Boolean(b.all),
      exlogs: Boolean(b.exlogs && Object.keys(b.exlogs).length),
      weights: false,   // décoché par défaut : on n'importe pas le poids d'un autre par erreur
      counter: false,
      goals: Boolean(b.goals),
    };
    // Nom du (des) profil(s) importé(s) — modifiable avant l'import.
    ui.importName = b.name || `Import ${new Date().toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}`;
  } catch (err) {
    ui.error = err.message;
  }
  rerender();
}

function ImportCard() {
  const area = h('textarea', {
    class: 'input input--code', rows: 5, placeholder: 'Colle ici un code AnabolicOS…',
    'aria-label': 'Code à importer', spellcheck: 'false', autocapitalize: 'off', id: 'imp-text',
    oninput: () => { ui.importText = area.value; },
  });
  area.value = ui.importText;

  const fileInput = h('input', {
    type: 'file', accept: 'application/json,.json,.txt', class: 'sr-only', id: 'imp-file',
    onchange: async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      if (f.size > 1_000_000) { ui.error = 'Fichier trop volumineux.'; rerender(); return; }
      analyse(await f.text());
    },
  });

  const children = [
    h('p', { class: 'eyebrow' }, 'Importer'),
    area,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn--ink', type: 'button', onclick: () => analyse(area.value) }, 'Analyser le code'),
      h('label', { class: 'btn btn--ghost', for: 'imp-file' }, icon('file', 18), 'Fichier'),
      fileInput),
  ];

  if (ui.error) children.push(h('p', { class: 'form-error' }, ui.error));

  if (ui.parsed) {
    const b = ui.parsed.bundle;
    const options = [
      b.workout && ['workout', T`Programme${b.name ? ` « ${b.name} »` : ''} · ${b.workout.sessions.length} séance(s)`],
      b.diet && ['diet', T`Diet · ${b.diet.meals.length} repas`],
      b.protocol && ['protocol', T`Protocole · ${b.protocol.days.length} jour(s)`],
      b.all && ['all', `Tous les profils de la sauvegarde`],
      b.exlogs && Object.keys(b.exlogs).length && ['exlogs', `Carnet de charges (fusion)`],
      b.weights?.length && ['weights', T`Poids · ${b.weights.length} pesée(s) — ajoutées sans écraser les tiennes`],
      b.counterBase != null && ['counter', T`Compteur de séances → ${b.counterBase} (remplace le tien)`],
      b.goals && ['goals', T`Objectifs · ${b.goals.items.length} (ajoutés aux tiens)`],
    ].filter(Boolean);

    children.push(h('div', { class: 'import-pick' },
      h('p', { class: 'muted' }, 'Contenu détecté — choisis ce que tu importes :'),
      options.map(([key, label]) => {
        const cb = h('input', { type: 'checkbox', checked: ui.pick[key], onchange: () => { ui.pick[key] = cb.checked; } });
        return h('label', { class: 'checkbox' }, cb, h('span', {}, label));
      }),
      (b.workout || b.diet || b.protocol) ? h('label', { class: 'field', for: 'imp-name' },
        h('span', { class: 'field__label' }, 'Nom du profil importé'),
        h('input', {
          class: 'input', id: 'imp-name', maxlength: 60, value: ui.importName, autocomplete: 'off',
          oninput: (e) => { ui.importName = e.target.value; },
        }),
        h('span', { class: 'field__hint' }, 'Renommable plus tard via ⋯ › Renommer dans chaque onglet.')) : null,
      h('p', { class: 'hint' }, 'Les programmes, diets et protocoles importés sont ajoutés comme nouveaux profils : rien n’est écrasé.'),
      h('button', {
        class: 'btn btn--primary btn--block', type: 'button',
        onclick: () => {
          const name = (ui.importName || '').trim().slice(0, 60);
          const done = applyImport(name ? { ...b, name } : b, ui.pick);
          if (!done.length) return toast('Rien de sélectionné.', { type: 'error' });
          toast(T`Importé : ${done.join(', ')}`);
          Object.assign(ui, { importText: '', parsed: null, error: null });
          rerender();
        },
      }, 'Importer la sélection')));
  }
  return h('section', { class: 'card' }, children);
}

export function ShareView() {
  ensureExlogs();   // la sauvegarde complète contient le carnet de charges
  return [
    PageHeader({
      eyebrow: 'Import / Export', title: 'Mes imports',
      trailing: IconButton('back', 'Retour', () => { location.hash = '#/me'; }, 'icon-btn--soft'),
    }),
    h('section', { class: 'card' },
      h('p', { class: 'eyebrow' }, 'Envoyer à un ami'),
      h('p', { class: 'muted' }, 'Programme, diet, protocole : un, plusieurs ou tout, en une fois. Ton ami le reçoit dans votre discussion.'),
      h('button', { class: 'btn btn--primary btn--block', type: 'button', style: { marginTop: '12px' }, onclick: sendToFriend }, icon('send', 18), 'Choisir et envoyer')),
    ExportCard(),
    ImportCard(),
    SectionTitle('Compatibilité'),
    h('p', { class: 'hint' }, "Les codes de l'ancienne version d'AnabolicOS (v3) s'importent directement."),
  ];
}
