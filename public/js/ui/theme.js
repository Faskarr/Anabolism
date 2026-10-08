/**
 * Thème clair / sombre / automatique (réglage stocké sur l'appareil).
 * Le thème est déjà appliqué avant l'affichage par un petit script dans
 * index.html (pas de flash blanc) ; ce module gère le changement en direct.
 */
const KEY = 'theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function getThemePref() {
  try { return localStorage.getItem(KEY) || 'light'; } catch { return 'light'; }
}

function apply(pref) {
  const dark = pref === 'dark' || (pref === 'auto' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111113' : '#F7F6F3');
}

export function setThemePref(pref) {
  try { localStorage.setItem(KEY, pref); } catch { /* stockage indisponible */ }
  apply(pref);
}

apply(getThemePref());
media.addEventListener?.('change', () => { if (getThemePref() === 'auto') apply('auto'); });
