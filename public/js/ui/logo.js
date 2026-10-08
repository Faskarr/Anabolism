/**
 * Logo « ANABOLICOS » animé en continu : la même oscillation 3D que l'animation
 * d'ouverture, rejouée en boucle toutes les 4 secondes.
 *
 * Les vues sont re-rendues à chaque mise à jour temps réel : pour que
 * l'animation ne redémarre pas à chaque rendu, on la cale sur une horloge
 * globale via un animation-delay négatif.
 */
import { h } from '../lib/dom.js';

const PERIOD_MS = 4000;
const t0 = performance.now();

export function LiveLogo({ size = 'sm' } = {}) {
  const phase = (performance.now() - t0) % PERIOD_MS;
  return h('span', { class: `brand brand--${size} brand--live`, 'aria-label': 'AnabolicOS' },
    h('span', { class: 'brand__inner', style: { animationDelay: `-${Math.round(phase)}ms` } },
      'Anabolic', h('span', { class: 'brand__accent' }, 'OS')));
}
