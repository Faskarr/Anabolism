/**
 * Fil des amis : records et musiques partagés, « likables ».
 * Utilisé par le widget Amis de l'accueil et par l'onglet Contact.
 */
import { h } from '../lib/dom.js';
import { frNum } from '../lib/dates.js';
import { state, ensureExlogs } from '../store.js';
import { toggleLike, sharePR, shareMusic, detectMusic, musicTargets, MUSIC_SERVICES, fetchLikes, deletePost, fetchMusicTitle } from '../data/posts.js';
import { ms } from '../data/messages.js';
import { shortWhen } from './chat.js';
import { Avatar } from './avatar.js';
import { icon } from './icons.js';
import { formSheet, openSheet, actionSheet, confirmSheet } from './sheet.js';
import { toast } from './toast.js';

import { T } from '../lib/i18n.js';
/**
 * Publications récentes de mes amis et moi (plus récentes d'abord).
 * Hors de l'onglet Contact, on se contente de la DERNIÈRE publication de chacun,
 * recopiée dans son document d'activité (aucune lecture supplémentaire).
 */
export function recentPosts(days = 7, max = 5) {
  const since = Date.now() - days * 86400000;
  const all = state.postsFeed
    ? Object.values(state.posts).flat()
    : Object.entries(state.friendActivity)
      .filter(([, a]) => a?.lastPost?.id)
      .map(([uid, a]) => ({ ...a.lastPost, owner: uid, name: a.name, partial: true }));
  return all
    .filter((p) => ms(p.at) > since)
    .sort((a, b) => ms(b.at) - ms(a.at))
    .slice(0, max);
}

/**
 * Sons conseillés : la dernière musique partagée par chacun (amis + moi), récente d'abord.
 * Un son reste affiché 5 jours, sauf si son auteur en partage un nouveau
 * (qui le remplace) ou le supprime avant.
 */
export function recentMusic(max = 10, days = 5) {
  const since = Date.now() - days * 86400000;
  return Object.entries(state.friendActivity)
    .map(([uid, a]) => {
      // Re-vérification du lien (défense en profondeur) : jamais de lien arbitraire.
      const m = a?.lastMusic?.url ? detectMusic(a.lastMusic.url) : null;
      return m ? { ...a.lastMusic, url: m.url, service: m.service, owner: uid, name: String(a.name || 'Ami'), partial: true } : null;
    })
    .filter((p) => p && ms(p.at) > since)
    .sort((a, b) => ms(b.at) - ms(a.at))
    .slice(0, max);
}

const rerender = () => window.dispatchEvent(new Event('app:render'));

/**
 * Likes des aperçus de l'accueil (copie sans les likes) : lus UNE fois par
 * session et par publication, puis tenus à jour localement à chaque tap.
 */
const likeCache = new Map();   // 'owner/id' → [uid…] | null (en cours)
function likesOf(post) {
  if (!post.partial) return post.likes || [];
  const key = `${post.owner}/${post.id}`;
  if (!likeCache.has(key)) {
    likeCache.set(key, null);
    fetchLikes(post.owner, post.id)
      .then((l) => { likeCache.set(key, l); rerender(); })
      .catch(() => likeCache.set(key, []));
  }
  return likeCache.get(key) || [];
}

export function LikeButton(post, me) {
  const likes = likesOf(post);
  const mine = post.owner === me;
  const liked = likes.includes(me);
  const n = likes.length;
  if (mine) {
    return h('span', { class: `like like--static${n ? ' like--on' : ''}`, 'aria-label': T`${n} like${n > 1 ? 's' : ''}` }, icon('heart', 18), n ? String(n) : '');
  }
  return h('button', {
    class: `like${liked ? ' like--on' : ''}`, type: 'button', 'aria-pressed': String(liked),
    'aria-label': liked ? 'Retirer mon like' : 'Liker',
    onclick: (e) => {
      e.stopPropagation();
      e.currentTarget.classList.add('like--pop');
      const next = liked ? likes.filter((u) => u !== me) : [...likes, me];
      if (post.partial) likeCache.set(`${post.owner}/${post.id}`, next);
      else post.likes = next;
      toggleLike(me, { ...post, likes });
      rerender();
    },
  }, icon('heart', 18), n ? String(n) : '');
}

/** Supprimer une de MES publications (son ou record). */
async function removeMine(post) {
  const what = post.type === 'music' ? 'ce son' : 'ce record';
  if (!(await confirmSheet({ title: T`Supprimer ${what} ?`, message: 'Il disparaît pour tes amis.', confirmLabel: 'Supprimer' }))) return;
  try { await deletePost(post.owner, post); toast(post.type === 'music' ? 'Son supprimé' : 'Record supprimé'); } catch (err) {
    console.error('[posts]', err); toast('Suppression impossible.', { type: 'error' });
  }
}

/**
 * Choix de l'app pour écouter un son : Spotify, Deezer ou YouTube Music.
 * Vrais liens <a> (et non window.open après coup) : sur iPhone, l'ouverture
 * doit partir directement du toucher, sinon Safari la bloque.
 */
export function openMusic(m) {
  const who = m.owner === state.me?.uid ? 'toi' : String(m.name || 'un ami').split(' ')[0];
  let sheet = null;
  const rows = musicTargets(m).map((t) => h('a', {
    class: `action music-open music-open--${t.key}`, href: t.href, target: '_blank', rel: 'noopener noreferrer',
    onclick: () => setTimeout(() => sheet?.close(), 300),
  },
  h('span', { class: 'music-open__dot', 'aria-hidden': 'true' }, icon('play', 14)),
  h('span', { class: 'music-open__label' }, t.label,
    h('span', { class: 'music-open__sub' }, t.original ? 'Lien partagé' : 'Recherche du titre')),
  icon('external', 16)));
  sheet = openSheet({
    title: m.title || 'Écouter le son',
    subtitle: T`Conseillé par ${who}. Ouvrir avec :`,
    body: h('div', { class: 'action-list' }, rows,
      m.title ? null : h('p', { class: 'hint' }, 'Sans titre, seul le lien d’origine est disponible.'),
      m.owner === state.me?.uid ? h('button', {
        class: 'action action--danger', type: 'button',
        onclick: () => { sheet.close(); setTimeout(() => removeMine({ ...m, type: 'music' }), 230); },
      }, icon('trash', 20), h('span', {}, 'Supprimer ce son')) : null),
  });
}

export function PostRow(post, me) {
  const who = post.owner === me ? 'Toi' : String(post.name || 'Ami').split(' ')[0];
  const head = h('span', { class: 'record__who' }, who, h('span', { class: 'record__when' }, T` · ${shortWhen(post.at)}`));

  if (post.type === 'music') {
    const ok = detectMusic(post.url);
    if (!ok) return null;                       // lien non conforme : ignoré
    post = { ...post, url: ok.url, service: ok.service };
    const svc = MUSIC_SERVICES[post.service]?.label || 'Musique';
    return h('li', { class: 'record record--music' },
      Avatar({ uid: post.owner, name: post.name, size: 'sm' }),
      h('button', { class: 'record__body record__link', type: 'button', onclick: () => openMusic(post) },
        head,
        h('span', { class: 'record__what' },
          h('span', { class: `music-tag music-tag--${post.service}` }, icon('music', 12), svc),
          ' ', post.title || 'Écouter le son')),
      LikeButton(post, me));
  }

  const what = [head,
    h('span', { class: 'record__what' }, '🏆 ', post.exercise, ' · ', h('strong', {}, T`${frNum(post.w, post.w % 1 ? 1 : 0)} kg × ${post.r}`))];
  return h('li', { class: 'record' },
    Avatar({ uid: post.owner, name: post.name, size: 'sm' }),
    post.owner === me
      ? h('button', {
        class: 'record__body record__link', type: 'button', 'aria-label': 'Options de mon record',
        onclick: () => actionSheet({ title: post.exercise, actions: [{ label: 'Supprimer ce record', icon: 'trash', danger: true, onClick: () => removeMine({ ...post, type: 'pr' }) }] }),
      }, what)
      : h('span', { class: 'record__body' }, what),
    LikeButton(post, me));
}

/**
 * Partage d'un son : lien collé depuis Spotify / Deezer / YouTube Music / Apple Music
 * (Partager › Copier le lien). Le titre se remplit tout seul quand c'est possible.
 */
export async function shareMusicFlow() {
  const pending = formSheet({
    title: 'Partager un son',
    subtitle: 'Dans ton app de musique : Partager › Copier le lien, puis colle-le ici. Le titre se remplit tout seul (sauf Deezer).',
    fields: [
      { name: 'url', type: 'url', label: 'Lien du titre / de la playlist', required: true, maxlength: 400, placeholder: 'https://open.spotify.com/track/…', inputmode: 'url' },
      // Titre obligatoire : il permet à tes amis d'ouvrir le son sur LEUR app (recherche).
      { name: 'title', label: 'Artiste – Titre', required: true, maxlength: 120, placeholder: 'Ex. Kanye West – Power' },
    ],
    submitLabel: 'Partager à mes amis',
  });
  // Remplissage automatique du titre dès qu'un lien valide est collé.
  const urlIn = document.getElementById('f_url');
  const titleIn = document.getElementById('f_title');
  let lastUrl = '';
  let touched = false;
  titleIn?.addEventListener('input', () => { touched = Boolean(titleIn.value.trim()); });
  urlIn?.addEventListener('input', async () => {
    const m = detectMusic(urlIn.value);
    if (!m || m.url === lastUrl) return;
    lastUrl = m.url;
    if (touched) return;
    titleIn.placeholder = 'Recherche du titre…';
    const t = await fetchMusicTitle(m.url, m.service);
    titleIn.placeholder = 'Ex. Kanye West – Power';
    if (t && !touched && lastUrl === m.url) { titleIn.value = t; titleIn.dispatchEvent(new Event('input')); touched = false; }
  });

  const r = await pending;
  if (!r?.values) return;
  const m = detectMusic(r.values.url);
  if (!m) { toast('Lien non reconnu : Spotify, Deezer, YouTube Music ou Apple Music uniquement.', { type: 'error', duration: 5000 }); return; }
  if (!state.me) return;
  shareMusic(state.me, { ...m, title: r.values.title });
}

// ── Partager un record (widget Amis de l'accueil) ───────────────────────

const e1rm = (w, r) => (r <= 1 ? w : w * (1 + r / 30));
const kg = (w) => frNum(w, w % 1 ? 1 : 0);

/** Meilleure série (1RM estimé) de chaque exercice du carnet, les plus récents d'abord. */
function bestSets() {
  const names = {};
  for (const prog of Object.values(state.workouts || {})) {
    for (const s of prog?.sessions || []) for (const e of s.exercises || []) names[e.id] ||= e.n;
  }
  return Object.entries(state.exlogs || {})
    .filter(([eid, arr]) => names[eid] && arr?.length)
    .map(([eid, arr]) => {
      const best = arr.reduce((b, x) => (e1rm(x.w, x.r) > e1rm(b.w, b.r) ? x : b), arr[0]);
      return { eid, name: names[eid], w: best.w, r: best.r, last: Math.max(...arr.map((x) => x.ts || 0)) };
    })
    .sort((a, b) => b.last - a.last)
    .slice(0, 10);
}

async function manualPR() {
  const r = await formSheet({
    title: 'Partager un record',
    fields: [
      { name: 'exercise', label: 'Exercice', required: true, maxlength: 120, placeholder: 'Ex. Squat' },
      { type: 'row', fields: [
        { name: 'w', type: 'number', label: 'Charge (kg)', required: true, min: 0.5, max: 999, inputmode: 'decimal' },
        { name: 'r', type: 'number', label: 'Répétitions', required: true, min: 1, max: 100, integer: true, inputmode: 'numeric' },
      ] },
    ],
    submitLabel: 'Partager à mes amis',
  });
  if (r?.values && state.me) sharePR(state.me, r.values);
}

/** Choix de l'exercice (meilleure série pré-remplie) ou saisie libre. */
export async function sharePRFlow() {
  if (!state.me) return;
  // Carnet chargé à la demande (3 s max : hors ligne, on propose la saisie libre).
  await Promise.race([ensureExlogs(), new Promise((r) => setTimeout(r, 3000))]).catch(() => {});
  const sets = bestSets();
  actionSheet({
    title: 'Partager un record',
    subtitle: sets.length ? 'Ta meilleure série par exercice (1RM estimé). Tes amis la verront sur leur accueil.' : 'Aucune charge notée pour l’instant : saisis ton record.',
    actions: [
      ...sets.map((x) => ({
        label: T`${x.name} · ${kg(x.w)} kg × ${x.r}`, icon: 'up',
        onClick: () => sharePR(state.me, { exercise: x.name, w: x.w, r: x.r }),
      })),
      { label: 'Autre record (saisie libre)', icon: 'edit', onClick: manualPR },
    ],
  });
}
