/**
 * Service worker Anabolism — démarrage instantané.
 *
 * Stratégies :
 *  • Fichiers de l'app (même origine) : CACHE D'ABORD. Chaque version (VERSION)
 *    est téléchargée EN ENTIER à l'installation du service worker, puis servie
 *    depuis le téléphone → plus aucune requête réseau au lancement, et jamais de
 *    mélange ancienne / nouvelle version (cause des pages blanches).
 *  • Nouvelle version déployée : le navigateur la détecte (sw.js modifié), la
 *    télécharge en arrière-plan, puis l'app se recharge d'elle-même si elle
 *    vient d'être ouverte, ou propose « Recharger » (voir app.js).
 *  • SDK Firebase (gstatic, URL versionnée) : cache d'abord, dans un cache
 *    STABLE (nommé d'après la version du SDK) : il survit aux mises à jour de
 *    l'app → pas de re-téléchargement de ~400 Ko à chaque déploiement.
 *  • Tout le reste (API Firestore, Auth, /__/auth/…) : NON intercepté.
 *
 * Incrémente VERSION à chaque déploiement (fait automatiquement avec la liste).
 */
const VERSION = 'vef3a3096b4';
const APP_CACHE = `app-${VERSION}`;
// Changer SDK_VERSION ici ET dans firebase.js / index.html lors d'une montée de version du SDK.
const SDK_VERSION = '12.19.0';
const CDN_CACHE = `cdn-firebase-${SDK_VERSION}`;
const SDK_FILES = ['app', 'auth', 'firestore']
  .map((m) => `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-${m}.js`);

const APP_SHELL = [
  '/',
  '/css/app.css',
  '/css/base.css',
  '/css/components.css',
  '/css/splash.css',
  '/css/tokens.css',
  '/fonts/barlow-condensed-latin-500-normal.woff2',
  '/fonts/barlow-condensed-latin-600-normal.woff2',
  '/js/app.js',
  '/js/auth.js',
  '/js/data/admin.js',
  '/js/data/avatars.js',
  '/js/data/backup.js',
  '/js/data/friends.js',
  '/js/data/goals.js',
  '/js/data/importer.js',
  '/js/data/inbox.js',
  '/js/data/links.js',
  '/js/data/messages.js',
  '/js/data/posts.js',
  '/js/data/profile.js',
  '/js/data/repo.js',
  '/js/data/shared.js',
  '/js/firebase.js',
  '/js/lib/dates.js',
  '/js/lib/dom.js',
  '/js/lib/i18n-en.js',
  '/js/lib/i18n.js',
  '/js/lib/ics.js',
  '/js/lib/ids.js',
  '/js/lib/image.js',
  '/js/lib/schedule.js',
  '/js/lib/schema.js',
  '/js/lib/stats.js',
  '/js/store.js',
  '/js/ui/ambient.js',
  '/js/ui/avatar.js',
  '/js/ui/chart.js',
  '/js/ui/chat.js',
  '/js/ui/cropper.js',
  '/js/ui/feed.js',
  '/js/ui/flag.js',
  '/js/ui/icons.js',
  '/js/ui/install.js',
  '/js/ui/layout.js',
  '/js/ui/logo.js',
  '/js/ui/motion.js',
  '/js/ui/sheet.js',
  '/js/ui/splash.js',
  '/js/ui/tabbar.js',
  '/js/ui/theme.js',
  '/js/ui/timer.js',
  '/js/ui/toast.js',
  '/js/ui/tour.js',
  '/js/views/admin-library.js',
  '/js/views/admin-links.js',
  '/js/views/admin-messages.js',
  '/js/views/admin.js',
  '/js/views/contact.js',
  '/js/views/diet-calc.js',
  '/js/views/diet.js',
  '/js/views/disabled.js',
  '/js/views/foundation.js',
  '/js/views/goals.js',
  '/js/views/home.js',
  '/js/views/login.js',
  '/js/views/me.js',
  '/js/views/messages-hub.js',
  '/js/views/profile.js',
  '/js/views/protocol.js',
  '/js/views/share.js',
  '/js/views/training.js',
  '/js/views/weight.js',
  '/js/views/workout-mode.js',
];

const CDN_HOSTS = ['www.gstatic.com'];

self.addEventListener('install', (event) => {
  // cache: 'reload' → on télécharge vraiment la nouvelle version (pas le cache HTTP).
  // Si un seul fichier manque, l'installation échoue et l'ancienne version reste
  // servie intacte : pas de page blanche.
  event.waitUntil(Promise.all([
    caches.open(APP_CACHE)
      .then((c) => c.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' })))),
    precacheSdk(),
  ]).then(() => self.skipWaiting()));
});

/**
 * SDK Firebase mis en cache dès l'installation (au mieux : un échec ici ne
 * bloque pas l'installation, le SDK sera mis en cache à sa première requête).
 * Déjà présent (cache stable) → rien n'est retéléchargé.
 */
async function precacheSdk() {
  const job = (async () => {
    const cache = await caches.open(CDN_CACHE);
    await Promise.all(SDK_FILES.map(async (u) => {
      if (await cache.match(u)) return;
      const r = await fetch(u, { mode: 'cors', credentials: 'omit' });
      if (r.ok) await cache.put(u, r);
    }));
  })().catch(() => { /* hors ligne : ignoré */ });
  // Au plus 10 s : un réseau lent ne doit pas retarder la nouvelle version.
  await Promise.race([job, new Promise((r) => setTimeout(r, 10000))]);
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        // On garde : la version courante, le SDK courant, et les photos de profil.
        keys.filter((k) => k !== APP_CACHE && k !== CDN_CACHE && !k.startsWith('avatars-'))
          .map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Same origin, hors routes réservées Firebase.
  if (url.origin === self.location.origin && !url.pathname.startsWith('/__/')) {
    event.respondWith(appFirst(request, event));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, event));
  }
  // Sinon : laisser passer (Firestore, Auth, Google…).
});

/**
 * Cache d'abord pour les fichiers de l'app (version complète téléchargée à
 * l'installation). Fichier absent du cache (ex. image) : réseau, puis mis en cache.
 */
// Ouverture du cache mémorisée : une seule ouverture par démarrage du service worker.
let appCachePromise = null;
const openAppCache = () => (appCachePromise ||= caches.open(APP_CACHE));

async function appFirst(request, event) {
  const cache = await openAppCache();
  const url = new URL(request.url);
  // Clé = chemin sans « ?v=… » : correspondance exacte (plus rapide que ignoreSearch).
  const key = request.mode === 'navigate' ? '/' : url.pathname;
  const cached = await cache.match(key);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && request.mode !== 'navigate') event.waitUntil(cache.put(key, response.clone()));
    return response;
  } catch {
    // Hors ligne : une page → l'app (elle gère le hors-ligne) ; un fichier → erreur réseau
    // normale (renvoyer index.html à la place d'un script ou d'une image le casserait).
    if (request.mode === 'navigate') return (await cache.match('/')) || Response.error();
    return Response.error();
  }
}

async function cacheFirst(request, event) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(request.url);
  if (cached) return cached;
  const response = await fetch(request);
  // Uniquement les réponses lisibles (CORS ok) : une réponse opaque peut être une erreur masquée.
  if (response.ok) event.waitUntil(cache.put(request.url, response.clone()));
  return response;
}
