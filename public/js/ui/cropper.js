/**
 * Recadrage de la photo de profil : l'image se déplace au doigt et se zoome
 * (pincement ou curseur) sous un cercle — exactement ce qui sera visible dans
 * le rond de l'app. Renvoie une image JPEG carrée (data URL) ou null.
 */
import { h } from '../lib/dom.js';
import { loadImage, cropJpeg } from '../lib/image.js';
import { openSheet } from './sheet.js';
import { icon } from './icons.js';

export async function cropAvatar(file) {
  const { img, url, w, h: ih } = await loadImage(file);

  return new Promise((resolve) => {
    let result = null;
    const V = Math.min(300, Math.round(window.innerWidth - 72));   // côté de la zone (px)
    const base = V / Math.min(w, ih);                               // échelle « couvre le cercle »
    let zoom = 1;                                                   // 1 … 4
    let x = (V - w * base) / 2;                                     // position du coin haut-gauche
    let y = (V - ih * base) / 2;

    img.className = 'crop__img';
    img.draggable = false;
    img.alt = '';

    const stage = h('div', { class: 'crop__stage', style: { width: `${V}px`, height: `${V}px` } },
      img, h('div', { class: 'crop__mask', 'aria-hidden': 'true' }));

    const slider = h('input', {
      type: 'range', class: 'crop__zoom', min: '1', max: '4', step: '0.01', value: '1', 'aria-label': 'Zoom',
      oninput: () => setZoom(Number(slider.value), V / 2, V / 2),
    });

    /** Garde l'image couvrant tout le cercle. */
    function clamp() {
      const s = base * zoom;
      x = Math.min(0, Math.max(V - w * s, x));
      y = Math.min(0, Math.max(V - ih * s, y));
    }
    function draw() {
      clamp();
      const s = base * zoom;
      img.style.width = `${w}px`;
      img.style.height = `${ih}px`;
      img.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    }
    /** Zoom autour d'un point (cx, cy) de la zone. */
    function setZoom(z, cx, cy) {
      const nz = Math.min(4, Math.max(1, z));
      const k = nz / zoom;
      x = cx - (cx - x) * k;
      y = cy - (cy - y) * k;
      zoom = nz;
      slider.value = String(nz);
      draw();
    }

    // Glisser (1 doigt) et pincer (2 doigts).
    const pts = new Map();
    let pinch = null;
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      }
    });
    stage.addEventListener('pointermove', (e) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pts.set(e.pointerId, cur);
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const r = stage.getBoundingClientRect();
        setZoom(pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      } else if (pts.size === 1) {
        x += cur.x - prev.x;
        y += cur.y - prev.y;
        draw();
      }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    // Molette / trackpad (ordinateur)
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    const sheet = openSheet({
      title: 'Recadrer ta photo',
      subtitle: 'Glisse pour placer ton visage dans le cercle, pince ou utilise le curseur pour zoomer.',
      body: h('div', { class: 'crop' },
        stage,
        h('div', { class: 'crop__bar' }, icon('user', 16), slider, icon('user', 22)),
        h('div', { class: 'form__actions' },
          h('button', {
            class: 'btn btn--primary btn--block', type: 'button',
            onclick: () => {
              const s = base * zoom;
              result = cropJpeg(img, { sx: -x / s, sy: -y / s, side: V / s });
              sheet.close();
            },
          }, icon('check', 18), 'Utiliser cette photo'),
          h('button', { class: 'btn btn--ghost btn--block', type: 'button', onclick: () => sheet.close() }, 'Annuler'))),
      onClose: () => { URL.revokeObjectURL(url); resolve(result); },
    });
    draw();
  });
}
