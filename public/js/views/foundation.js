/**
 * Écran « socle » — PHASE 1 uniquement.
 * Vérifie en conditions réelles que toute la chaîne fonctionne :
 * Auth Google → profil Firestore → écriture → règles de sécurité → rôle admin.
 * Accessible depuis Moi › Diagnostic.
 */
import { h, mount } from '../lib/dom.js';
import { greeting } from '../lib/dates.js';
import { db, fs } from '../firebase.js';
import { signOut } from '../auth.js';

import { T } from '../lib/i18n.js';
import { tx } from '../lib/i18n.js';
const { doc, getDoc, updateDoc, serverTimestamp } = fs;

/** Rejette si la promesse ne se résout pas à temps (ex. hors ligne). */
const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(T`${label} : délai dépassé`)), ms)),
]);

function Avatar(user) {
  if (user.photoURL) {
    return h('img', { class: 'avatar', src: user.photoURL, alt: '', referrerpolicy: 'no-referrer' });
  }
  return h('div', { class: 'avatar', 'aria-hidden': 'true' },
    (user.displayName || user.email || '?').charAt(0).toUpperCase());
}

function CheckRow(label) {
  const dot = h('span', { class: 'check__dot', 'aria-hidden': 'true' }, '…');
  const meta = h('span', { class: 'check__meta' });
  const row = h('li', { class: 'check' }, dot, h('span', { class: 'check__label' }, label), meta);
  return {
    row,
    set(ok, text) {
      row.className = `check ${ok ? 'check--ok' : 'check--fail'}`;
      dot.textContent = ok ? '✓' : '!';
      meta.textContent = tx(text || '');
    },
  };
}

// Construit une seule fois par session : les tests (dont une écriture) ne
// doivent pas se relancer à chaque mise à jour temps réel du store.
let cached = null;
let cachedUid = null;

export function FoundationView(session) {
  if (cached && cachedUid === session.user.uid) return cached;
  cachedUid = session.user.uid;
  cached = buildFoundation(session);
  return cached;
}

/** Mesures d'affichage (pour régler la barre d'onglets dans Safari). */
function screenInfo() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;bottom:0;left:0;width:1px;padding-bottom:env(safe-area-inset-bottom);visibility:hidden';
  document.body.appendChild(probe);
  const safe = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
  probe.remove();
  const tab = document.querySelector('.tabbar')?.getBoundingClientRect();
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  return [
    ['Mode', standalone ? 'App installée' : 'Safari (onglet)'],
    ['Safe-area bas', `${Math.round(safe)} px`],
    ['Fenêtre', `${innerWidth} × ${innerHeight}`],
    ['Viewport visuel', `${Math.round(visualViewport?.height || 0)} px`],
    ['Écran', `${screen.width} × ${screen.height}`],
    ['Barre d’onglets', tab ? T`haut ${Math.round(tab.top)} · bas ${Math.round(tab.bottom)}` : '—'],
  ];
}

function buildFoundation(session) {
  const { user, isAdmin, adminError, created } = session;
  const first = (user.displayName || '').split(' ')[0];

  const checks = {
    auth:   CheckRow('Connexion Google'),
    profil: CheckRow('Profil utilisateur'),
    write:  CheckRow('Écriture Firestore'),
    rules:  CheckRow('Règles de sécurité'),
    role:   CheckRow('Rôle'),
  };

  // UID affiché + copie : c'est l'ID exact à utiliser pour admins/{uid}.
  const copyBtn = h('button', {
    class: 'btn btn--ghost btn--block', type: 'button', style: { marginTop: '12px' },
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(user.uid);
        copyBtn.textContent = tx('UID copié ✓');
      } catch {
        copyBtn.textContent = tx('Copie impossible — sélectionne le texte');
      }
    },
  }, 'Copier mon UID');
  const uidCard = h('section', { class: 'card' },
    h('h2', { class: 'card__title' }, 'Mon UID'),
    h('p', { class: 'card__text', style: { fontFamily: 'ui-monospace, Menlo, monospace', wordBreak: 'break-all', userSelect: 'all', color: 'var(--ink)' } }, user.uid),
    copyBtn);
  const list = h('ul', { class: 'checks' }, Object.values(checks).map((c) => c.row));

  const view = h('main', { class: 'screen' },
    h('header', { class: 'topbar' },
      h('span', { class: 'brand brand--sm' }, 'Anabolic', h('span', { class: 'brand__accent' }, 'OS')),
      Avatar(user),
    ),
    h('section', { class: 'hello' },
      h('p', { class: 'eyebrow' }, greeting()),
      h('p', { class: 'hello__name' }, first || 'Athlète'),
    ),
    h('section', { class: 'card' },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        h('h2', { class: 'card__title' }, 'Socle opérationnel'),
        isAdmin ? h('span', { class: 'badge' }, 'Admin') : null,
      ),
      h('p', { class: 'card__text' }, 'Vérification de la nouvelle infrastructure.'),
      list,
    ),
    uidCard,
    h('section', { class: 'card' },
      h('h2', { class: 'card__title' }, 'Affichage'),
      h('p', { class: 'card__text' }, 'Fais une capture de ce bloc si la barre du bas est mal placée.'),
      (() => {
        // Mesuré après l'affichage (la barre d'onglets doit être en place).
        const ul = h('ul', { class: 'kv' });
        const fill = () => ul.replaceChildren(...screenInfo().map(([k, v]) => h('li', {}, h('span', {}, k), h('strong', {}, v))));
        setTimeout(fill, 400);
        window.addEventListener('resize', fill);
        return ul;
      })()),
    h('div', { style: { marginTop: '24px', textAlign: 'center' } },
      h('button', { class: 'btn btn--quiet', type: 'button', onclick: signOut }, 'Se déconnecter'),
    ),
  );

  runChecks(user, created, isAdmin, adminError, checks);
  return view;
}

async function runChecks(user, created, isAdmin, adminError, checks) {
  checks.auth.set(true, user.email);
  checks.profil.set(true, created ? 'créé' : 'retrouvé');

  // 1. Écriture réelle sur son propre profil (doit réussir).
  try {
    await withTimeout(
      updateDoc(doc(db, 'users', user.uid), { lastActiveAt: serverTimestamp() }),
      8000, 'Écriture');
    checks.write.set(true, 'OK');
  } catch (err) {
    checks.write.set(false, err.code || err.message);
  }

  // 2. Lecture du statut admin d'un AUTRE compte : refusée pour TOUT LE MONDE,
  //    admin compris (règle admins/{uid} : lecture par le propriétaire seul).
  //    Si elle passe, les règles ne sont pas déployées (mode test).
  //    NB : users/{autre} n'est pas un bon test, l'admin a le droit de le lire.
  try {
    await withTimeout(getDoc(doc(db, 'admins', 'probe-other-user')), 8000, 'Règles');
    checks.rules.set(false, 'NON PROTÉGÉ');
  } catch (err) {
    if (err.code === 'permission-denied') checks.rules.set(true, 'actives');
    else checks.rules.set(false, err.code || err.message);
  }

  if (adminError) checks.role.set(false, T`admin : ${adminError}`);
  else checks.role.set(true, isAdmin ? 'Administrateur' : 'Utilisateur');
}
