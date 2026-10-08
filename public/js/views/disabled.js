import { h } from '../lib/dom.js';
import { signOut } from '../auth.js';

export function DisabledView() {
  return h('main', { class: 'screen' },
    h('div', { class: 'center-stack' },
      h('div', { class: 'card' },
        h('p', { class: 'eyebrow' }, 'Compte suspendu'),
        h('h1', { class: 'card__title', style: { marginTop: '8px' } }, 'Ton compte est désactivé'),
        h('p', { class: 'card__text' },
          "Tes données sont conservées. Contacte l'administrateur pour le réactiver."),
      ),
      h('button', { class: 'btn btn--quiet', type: 'button', onclick: signOut }, 'Se déconnecter'),
    ),
  );
}
