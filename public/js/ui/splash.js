/**
 * Animation d'ouverture.
 *
 *  • Lancement à froid : le logo (déjà animé par le CSS en ligne d'index.html)
 *    reste au moins MIN_MS, puis s'efface dès que la session est connue.
 *  • Retour dans l'app après 1 min d'absence : l'animation est rejouée,
 *    l'app revient sur l'accueil et les widgets se remettent en place.
 */
const MIN_MS = 320;   // durée minimale du logo, comptée depuis l'ouverture de la page
const OUT_MS = 300;
const AWAY_MS = 60 * 1000; // revenir dans l'app après 1 min = « réouverture »

const el = () => document.getElementById('splash');

/**
 * Filet de sécurité : si iOS sert un ancien index.html (sans le splash), on
 * l'injecte ici. Ce module est importé EN PREMIER par app.js pour s'exécuter
 * avant l'initialisation de Firebase.
 */
(function ensureSplashMarkup() {
  if (el()) return;
  if (!document.querySelector('link[href^="/css/splash.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/splash.css';
    document.head.appendChild(link);
  }
  const s = document.createElement('div');
  s.id = 'splash';
  s.setAttribute('aria-hidden', 'true');
  const logo = document.createElement('div');
  logo.className = 'splash__logo';
  logo.append('Anabolic');
  const os = document.createElement('span');
  os.className = 'splash__os';
  os.textContent = 'OS';
  logo.appendChild(os);
  const line = document.createElement('div');
  line.className = 'splash__line';
  line.appendChild(document.createElement('span'));
  s.append(logo, line);
  document.body.prepend(s);
}());

let shownAt = 0;   // performance.now() part du début de la navigation
let hiddenAt = null;

/** Masque le splash en respectant la durée minimale de l'animation. */
let outAt = 0;

export function hideSplash() {
  const s = el();
  if (!s || s.classList.contains('splash--out')) return;
  if (outAt > performance.now()) return; // déjà programmé
  const wait = Math.max(0, MIN_MS - (performance.now() - shownAt));
  outAt = performance.now() + wait;
  setTimeout(() => s.classList.add('splash--out'), wait);
}

/**
 * Instant (performance.now) où le splash commence à s'effacer — 0 s'il est
 * déjà parti. Sert à caler l'entrée des widgets juste derrière.
 */
export function splashOutAt() {
  const s = el();
  if (!s || (s.classList.contains('splash--out') && outAt <= performance.now())) return 0;
  return outAt || performance.now() + MIN_MS;
}

/** Rejoue l'animation (retour après une longue absence). */
export function replaySplash(onShown) {
  const s = el();
  if (!s) return;
  // Mouvement réduit demandé : pas de relecture, simple retour à l'accueil.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { onShown?.(); return; }
  // Redémarre les animations CSS en recréant les nœuds animés.
  s.querySelectorAll('.splash__logo, .splash__line span').forEach((n) => n.replaceWith(n.cloneNode(true)));
  s.classList.remove('splash--out');
  shownAt = performance.now();
  outAt = 0;
  onShown?.();
  hideSplash();
}

/** Active la relecture au retour dans l'app. */
export function watchResume(onResume) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS) replaySplash(onResume);
    hiddenAt = null;
  });
}

export const SPLASH_OUT_MS = OUT_MS;
