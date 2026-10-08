import { h } from '../lib/dom.js';
import { signIn, warmUpSignIn, signInReady, redirectPending } from '../auth.js';
import { toast } from '../ui/toast.js';
import { LiveLogo } from '../ui/logo.js';
import { InstallCard } from '../ui/install.js';

import { tx } from '../lib/i18n.js';
import { LangButton } from '../ui/flag.js';
const GOOGLE_ICON = () => {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  const paths = [
    ['#4285F4', 'M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'],
    ['#34A853', 'M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z'],
    ['#FBBC05', 'M5.84 14.09A6.6 6.6 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84z'],
    ['#EA4335', 'M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z'],
  ];
  for (const [fill, d] of paths) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('fill', fill);
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
};

export function LoginView() {
  const label = h('span', {}, 'Continuer avec Google');
  let forced = false;
  const button = h('button', {
    class: 'btn btn--ghost btn--block',
    type: 'button',
    onclick: async () => {
      if (!signInReady() && !forced) return;  // sécurité : jamais de toucher « dans le vide »
      button.disabled = true;
      // Fenêtre fermée sans réponse (iOS) : le bouton redevient utilisable.
      const unlock = setTimeout(() => { button.disabled = false; }, 4000);
      try {
        await signIn();
      } catch (err) {
        toast(err.message, { type: 'error', duration: 6000 });
      } finally {
        clearTimeout(unlock);
        button.disabled = false;
      }
    },
  }, GOOGLE_ICON(), label);

  // Le bouton attend que le module Google soit prêt (quelques centaines de ms).
  // Retour de Google après connexion : « Connexion… » le temps de finaliser.
  if (!signInReady()) {
    button.disabled = true;
    label.textContent = tx(redirectPending() ? 'Connexion…' : 'Préparation…');
    const enable = () => { button.disabled = false; label.textContent = tx('Continuer avec Google'); };
    warmUpSignIn().then((r) => {
      enable();
      if (r?.error) toast(r.error, { type: 'error', duration: 6000 });
    });
    setTimeout(() => { forced = true; enable(); }, 8000);   // réseau très lent : on laisse essayer
  }

  return h('main', { class: 'screen' },
    LangButton({ cls: 'login__lang' }),   // avant connexion : un ami anglophone peut basculer tout de suite
    h('div', { class: 'center-stack' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Entraînement · Nutrition · Protocole'),
        h('h1', { style: { marginTop: '12px' } }, LiveLogo({ size: 'hero' })),
      ),
      h('div', {},
        button,
        h('p', { class: 'login__foot', style: { marginTop: '16px' } },
          'Tes données sont privées et synchronisées sur tous tes appareils.'),
        h('div', { style: { marginTop: '24px', textAlign: 'left' } }, InstallCard({ compact: true, force: true })),
      ),
    ),
  );
}
