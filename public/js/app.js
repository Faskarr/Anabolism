/**
 * Point d'entrée de l'app : session → store → routeur → vues.
 *
 * Routes (hash) :
 *   #/home  #/training  #/diet  #/protocol
 *   #/contact (messagerie)  #/contact/coach  #/friends/<id>  #/admin/messages
 *   #/diet/calc (calculateur)
 *   #/me  #/me/weight  #/me/share  #/me/check  #/me/goals
 *   #/admin  #/admin/user/<uid>  #/admin/conv/<uid>  #/admin/library  (administrateur uniquement)
 *
 * Chaque vue est une fonction (session, param?) => Node[] ; elle est ré-exécutée
 * à chaque changement du store (temps réel) ou de route.
 */
// En premier : le splash doit s'afficher avant l'initialisation de Firebase.
import { hideSplash, watchResume, splashOutAt } from './ui/splash.js';
import './ui/theme.js';
import { initAmbient } from './ui/ambient.js';
initAmbient();
import { mount, h } from './lib/dom.js';
import { toast } from './ui/toast.js';
import { onSession } from './auth.js';
import { state, startStore, stopStore, subscribe, startAdminFeeds, unreadCount, rollWeekIfNeeded } from './store.js';
import { Skeleton } from './ui/layout.js';
import { startSharedPublisher } from './data/shared.js';
import { TabBar } from './ui/tabbar.js';
import { showTimer, stopTimer } from './ui/timer.js';
import { LoginView } from './views/login.js';
import { DisabledView } from './views/disabled.js';
import { HomeView } from './views/home.js';
import { TrainingView } from './views/training.js';
import { DietView } from './views/diet.js';
import { ProtocolView } from './views/protocol.js';
import { MeView } from './views/me.js';
import { WeightView } from './views/weight.js';
import { ContactView, leaveContact } from './views/contact.js';
import { MessagesHubView, FriendChatView, leaveFriendChat, leaveHub } from './views/messages-hub.js';
import { GoalsView } from './views/goals.js';
import { langReady } from './lib/i18n.js';

// Anglais : le dictionnaire (chargé à la demande, en cache) doit être prêt avant le 1er affichage.
await langReady;

// Version des fichiers statiques (à incrémenter à chaque déploiement visuel).
export const ASSET_VERSION = '0.9.1';

/**
 * Garde-fou : si un ancien index.html (mis en cache par iOS) est servi avec le
 * nouveau JavaScript, les feuilles de style récentes manquent. On les ajoute.
 */
function ensureStyles() {
  for (const name of ['splash', 'tokens', 'base', 'components', 'app']) {
    if (!document.querySelector(`link[href^="/css/${name}.css"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `/css/${name}.css?v=${ASSET_VERSION}`;
      document.head.appendChild(link);
    }
  }
}
ensureStyles();

// Safari (onglet) vs app installée sur l'écran d'accueil : dans Safari, la barre
// d'adresse occupe déjà le bas de l'écran → pas de marge de sécurité en plus.
const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
document.documentElement.classList.toggle('in-browser', !standalone);

/**
 * Liens externes depuis l'app installée sur iPhone : iOS les ouvre sinon dans un
 * navigateur intégré à l'app. On les confie à Safari (schéma x-safari-https,
 * iOS 17+), d'où Spotify, YouTube… prennent le relais si l'app est installée.
 * Si Safari ne s'ouvre pas (ancien iOS), on ouvre le lien normalement.
 */
const APP_HOSTS = /(^|\.)(spotify\.com|spotify\.link|deezer\.com|deezer\.page\.link|youtube\.com|youtu\.be|music\.apple\.com)$/i;
const IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (standalone && IOS) {
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a || e.defaultPrevented) return;
    let u;
    try { u = new URL(a.href, location.href); } catch { return; }
    if (!/^https?:$/.test(u.protocol) || u.origin === location.origin) return;
    // Musique et vidéos : comportement normal, qui ouvre directement l'app (Spotify, Deezer, YouTube…).
    if (APP_HOSTS.test(u.hostname)) return;
    e.preventDefault();
    const fallback = setTimeout(() => { location.href = u.href; }, 1500);
    document.addEventListener('visibilitychange', () => clearTimeout(fallback), { once: true });
    location.href = `x-safari-${u.href}`;   // « x-safari-https://… »
  });
}

/**
 * Écrans rarement ouverts (admin, calculateur, import/export, diagnostic) :
 * chargés À LA DEMANDE. Le démarrage n'a pas à télécharger ni analyser leur code.
 */
const lazyModules = new Map();
const once = (load) => { let p = null; return () => (p ||= load()); };
const LAZY = {
  admin:    once(() => import('./views/admin.js')),
  adminMsg: once(() => import('./views/admin-messages.js')),
  library:  once(() => import('./views/admin-library.js')),
  links:    once(() => import('./views/admin-links.js')),
  calc:     once(() => import('./views/diet-calc.js')),
  share:    once(() => import('./views/share.js')),
  check:    once(() => import('./views/foundation.js')),
  profile:  once(() => import('./views/profile.js')),
};
/** Vue d'un module chargé à la demande (écran de chargement en attendant). */
function lazyView(key, name) {
  return (...args) => {
    const mod = lazyModules.get(key);
    if (mod) return mod[name](...args);
    LAZY[key]().then((m) => { lazyModules.set(key, m); render(); })
      .catch((err) => { console.error('[lazy]', err); toast('Écran indisponible hors connexion.', { type: 'error' }); });
    return Skeleton(4);
  };
}
const lazyLeave = (key, name) => () => lazyModules.get(key)?.[name]?.();

/**
 * Table de routage. `admin: true` = réservé à l'administrateur.
 * `leave` = nettoyage quand on quitte l'écran (abonnements temps réel).
 */
const ROUTES = {
  home:           { view: HomeView },
  training:       { view: TrainingView },
  diet:           { view: DietView },
  'diet/calc':    { view: lazyView('calc', 'DietCalcView') },
  protocol:       { view: ProtocolView },
  me:             { view: MeView },
  'me/weight':    { view: WeightView },
  'me/share':     { view: lazyView('share', 'ShareView') },
  goals:          { view: GoalsView },
  'me/goals':     { view: GoalsView },   // ancien lien
  // Contact = messagerie : coach (ou messages des utilisateurs pour l'admin) + amis.
  contact:          { view: MessagesHubView, leave: leaveHub },
  'contact/coach':  { view: ContactView, leave: leaveContact, chat: true },
  friends:          { view: FriendChatView, param: true, leave: leaveFriendChat, chat: true },
  'admin/messages': { view: lazyView('adminMsg', 'AdminInboxView'), admin: true },
  'me/check':     { view: lazyView('check', 'FoundationView') },
  u:              { view: lazyView('profile', 'ProfileView'), param: true, leave: lazyLeave('profile', 'leaveProfile') },
  admin:          { view: lazyView('admin', 'AdminHomeView'), admin: true },
  'admin/library': { view: lazyView('library', 'AdminLibraryView'), admin: true },
  'admin/links':   { view: lazyView('links', 'AdminLinksView'), admin: true },
  'admin/user':   { view: lazyView('admin', 'AdminUserView'), admin: true, param: true, leave: lazyLeave('admin', 'leaveAdminUser') },
  'admin/conv':   { view: lazyView('adminMsg', 'AdminConversationView'), admin: true, param: true, leave: lazyLeave('adminMsg', 'leaveAdminConversation'), chat: true },
};

const root = document.getElementById('app');

/**
 * Entrée des pages : les blocs glissent en place l'un après l'autre.
 * Les vues sont re-rendues à chaque mise à jour temps réel ; pour qu'un rendu
 * en plein milieu ne coupe pas l'animation, chaque rendu recalcule le délai
 * de chaque bloc par rapport à l'instant de départ (délai négatif = reprise).
 */
const ENTER = { STEP_MS: 45, DURATION_MS: 420 };
let enter = { pending: true, at: 0 };

function applyEnter() {
  const def = ROUTES[current.key];
  // Toutes les pages, sauf les conversations (défilement en bas + zone de saisie fixe).
  if (def.chat || !state.ready) { viewEl.classList.remove('view--enter'); return; }
  const now = performance.now();
  if (enter.pending) {
    // Départ juste après l'effacement du splash (ou tout de suite s'il est parti).
    enter = { pending: false, at: Math.max(now, splashOutAt()) };
  }
  const kids = [...viewEl.children];
  const total = enter.at + kids.length * ENTER.STEP_MS + ENTER.DURATION_MS;
  if (now > total) { viewEl.classList.remove('view--enter'); return; }
  viewEl.classList.add('view--enter');
  kids.forEach((el, i) => { el.style.animationDelay = `${Math.round(enter.at - now + i * ENTER.STEP_MS)}ms`; });
}
let session = null;
let tourPlanned = false;   // présentation déjà programmée (ou déjà vue)
let current = { key: 'home', param: null };
let viewEl = null;
let tabHost = null;
let unsubStore = null;
let adminFeeds = false;

/** '#/admin/conv/abc' → { key: 'admin/conv', param: 'abc' } */
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  for (let n = parts.length; n > 0; n -= 1) {
    const key = parts.slice(0, n).join('/');
    const def = ROUTES[key];
    if (!def) continue;
    const rest = parts.slice(n);
    if (def.param && rest.length === 1) {
      let param = rest[0];
      try { param = decodeURIComponent(param); } catch { /* lien mal formé : gardé tel quel */ }
      return { key, param };
    }
    if (!def.param && rest.length === 0) return { key, param: null };
  }
  return { key: 'home', param: null };
}

function LoadingView() {
  return h('main', { class: 'screen', 'aria-busy': 'true' });
}

function ErrorView(error) {
  return h('main', { class: 'screen' },
    h('div', { class: 'center-stack' },
      h('div', { class: 'card' },
        h('h1', { class: 'card__title' }, 'Impossible de charger ton compte'),
        h('p', { class: 'card__text' }, error?.code || error?.message || 'Erreur inconnue'),
        h('button', {
          class: 'btn btn--ink btn--block', style: { marginTop: '16px' },
          type: 'button', onclick: () => location.reload(),
        }, 'Réessayer'))));
}

function mountShell() {
  viewEl = h('main', { class: 'view', id: 'view' });
  tabHost = h('div');
  mount(root, h('div', { class: 'shell' }, viewEl, tabHost));
}

/**
 * Rend la vue courante. Préserve le champ en cours de saisie (valeur + curseur)
 * pour qu'une mise à jour temps réel n'efface pas ce que l'utilisateur tape.
 */
/**
 * Rendu groupé : une rafale de mises à jour temps réel (écriture locale, accusé
 * serveur, documents liés…) ne produit qu'UN rendu par image affichée.
 */
let frame = 0;
function scheduleRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; render(); });
}

function render({ scrollTop = false } = {}) {
  if (frame) { cancelAnimationFrame(frame); frame = 0; }
  // Écran de connexion : redessiné en entier (changement de langue avant connexion).
  if (session?.state === 'signed-out') { mount(root, LoginView()); return; }
  if (!session || session.state !== 'active' || !viewEl) return;

  const def = ROUTES[current.key];
  if (def.admin && !session.isAdmin) { location.hash = '#/home'; return; }

  const active = document.activeElement;
  // Champ en cours de saisie (texte uniquement : jamais fichier, case, curseur…).
  const keep = active && active.id && viewEl.contains(active) && 'value' in active
    && !['file', 'checkbox', 'radio', 'range', 'time', 'date'].includes(active.type)
    ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd }
    : null;

  showTimer(current.key === 'training');
  document.documentElement.classList.toggle('route-chat', Boolean(def.chat || def.chatIf?.(session)));
  try {
    mount(viewEl, [def.view(session, current.param)].flat(Infinity));
  } catch (err) {
    console.error('[render]', err);
    mount(viewEl, h('div', { class: 'card' }, h('p', { class: 'card__title' }, 'Erreur d’affichage'), h('p', { class: 'card__text' }, String(err.message))));
  }
  applyEnter();
  mount(tabHost, TabBar(current.key, { contact: unreadCount() }));

  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      el.value = keep.value;
      el.focus({ preventScroll: true });
      try { el.setSelectionRange(keep.start, keep.end); } catch { /* type sans sélection */ }
    }
  }
  if (scrollTop) window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => {
  const next = parseRoute();
  const prev = ROUTES[current.key];
  if (prev?.leave && (next.key !== current.key || next.param !== current.param)) prev.leave();
  current = next;
  enter = { pending: true, at: 0 };
  render({ scrollTop: true });
});
window.addEventListener('app:render', scheduleRender);

onSession((s) => {
  // Autre compte que la session affichée en attendant Firebase, ou déconnexion :
  // on recharge la page (rapide grâce au service worker) pour repartir d'un état
  // propre — aucun cache en mémoire (code ami, brouillons, liens…) ne survit.
  if (session?.state === 'active' && s.state === 'active' && session.user.uid !== s.user.uid) {
    try { localStorage.setItem('lastUid', s.user.uid); } catch { /* ignoré */ }
    location.reload();
    return;
  }
  if (session?.state === 'active' && s.state === 'signed-out') {
    location.reload();
    return;
  }
  const wasActive = session?.state === 'active';
  const sameSession = wasActive && s.state === 'active';
  // Connexion depuis l'écran de connexion : on arrive toujours sur l'accueil.
  if (session?.state === 'signed-out' && s.state === 'active' && location.hash && location.hash !== '#/home') {
    history.replaceState(null, '', '#/home');
  }
  session = s;

  // Dès que l'état de session est connu, l'animation d'ouverture s'efface.
  if (s.state !== 'loading') hideSplash();

  if (s.state !== 'active') {
    if (wasActive) {
      ROUTES[current.key]?.leave?.();
      unsubStore?.(); unsubStore = null; stopStore(); stopTimer(); showTimer(false);
    }
    viewEl = null;
    document.documentElement.classList.remove('route-chat', 'kb-open');
    switch (s.state) {
      case 'loading':    mount(root, LoadingView()); break;
      case 'signed-out': mount(root, LoginView()); break;
      case 'disabled':   mount(root, DisabledView()); break;
      case 'error':      mount(root, ErrorView(s.error)); break;
    }
    return;
  }

  if (!wasActive) {
    enter = { pending: true, at: 0 };
    startStore(s.user.uid, s.user);
    startSharedPublisher(s.user.uid);   // profil visible par les amis (selon ses choix)
    adminFeeds = false;
  }
  if (s.isAdmin && !adminFeeds) { adminFeeds = true; startAdminFeeds(); }
  if (!wasActive) {
    unsubStore = subscribe(scheduleRender);
    mountShell();
  }
  current = parseRoute();
  // Confirmation d'une session déjà affichée : simple mise à jour, sans remonter en haut.
  render({ scrollTop: !sameSession });

  maybeShowTour();
});

/**
 * Présentation de l'app : une seule fois, par-dessus l'ACCUEIL, pour tout compte
 * qui ne l'a jamais vue sur cet appareil (ensuite : Moi › Découvrir l'app).
 * Module chargé uniquement dans ce cas.
 */
function maybeShowTour() {
  if (tourPlanned || session?.state !== 'active' || current.key !== 'home') return;
  const uid = session.user.uid;
  try { if (localStorage.getItem(`tour:v1:${uid}`) === '1') { tourPlanned = true; return; } } catch { return; }
  tourPlanned = true;
  // Juste après l'entrée des widgets (et le départ du logo).
  const wait = Math.max(0, splashOutAt() - performance.now()) + 650;
  setTimeout(() => {
    if (session?.state !== 'active' || current.key !== 'home') { tourPlanned = false; return; }
    import('./ui/tour.js').then((m) => m.showTour(uid)).catch(() => { tourPlanned = false; });
  }, wait);
}
window.addEventListener('hashchange', maybeShowTour);

// Minuit : « aujourd'hui » change (accueil, protocole, habitudes) et, le lundi, la semaine.
(function scheduleMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(() => { rollWeekIfNeeded(); render(); scheduleMidnight(); }, next - now);
}());

// Retour dans l'app après une longue absence : animation rejouée + accueil.
watchResume(() => {
  ROUTES[current.key]?.leave?.();
  enter = { pending: true, at: 0 };
  if (location.hash !== '#/home') location.hash = '#/home';
  else render({ scrollTop: true }); // déjà sur l'accueil : rejoue l'entrée des widgets
});

// Service worker : cache de l'app pour un démarrage rapide et hors ligne.
// Service worker : l'app est servie depuis le téléphone (démarrage instantané).
// Quand une nouvelle version est installée en arrière-plan, on recharge tout de
// suite si l'app vient d'être ouverte, sinon on propose de recharger.
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;          // toute première installation
    if (performance.now() < 8000) { reloading = true; location.reload(); return; }
    toast('Nouvelle version d’AnabolicOS installée', {
      duration: 20000, action: { label: 'Recharger', onClick: () => location.reload() },
    });
  });
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    // Retour dans l'app : on vérifie s'il y a une mise à jour.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch((err) => console.warn('[sw]', err));
}
