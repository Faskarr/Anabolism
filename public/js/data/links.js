/**
 * Liens utiles (Moi › Liens & réglages), modifiables par l'admin.
 *
 *   config/links         { items: [...], updatedAt }  lisible par tous les connectés
 *   config/linksPrivate  { items: [...], updatedAt }  lisible par l'admin seulement
 *
 * Un lien « visible seulement par moi » est rangé dans linksPrivate : il n'est
 * jamais envoyé aux autres utilisateurs (ni dans les données, ni dans le code).
 *
 * Coût : 1 lecture par session à l'ouverture de Moi (+1 pour l'admin).
 */
import { db, fs } from '../firebase.js';
import { uid as newId } from '../lib/ids.js';

const { doc, getDoc, writeBatch, serverTimestamp } = fs;

export const LINK_ICONS = ['link', 'play', 'message', 'music', 'leaf', 'pill', 'dumbbell', 'heart'];

/** Liens par défaut tant que l'admin n'a rien enregistré. */
const DEFAULTS = [
  { label: 'Faskarr sur TikTok', sub: '@faskarr', href: 'https://www.tiktok.com/@faskarr', icon: 'play' },
  { label: 'Discord BioHacking', sub: 'La communauté', href: 'https://discord.gg/DHVucvwrk', icon: 'message' },
  { label: 'HSN', sub: 'Nutrition sportive & compléments', href: 'https://www.hsnstore.fr/', icon: 'link' },
  { label: 'High League Supplements', sub: 'hlsupps.com', href: 'https://hlsupps.com/', icon: 'link' },
  { label: 'Hemia Cosmetics', sub: 'hemiacosmetics.com', href: 'https://www.hemiacosmetics.com/', icon: 'link' },
].map((l, i) => ({ id: `def${i}`, ...l, private: false }));

/** Valide un lien : https uniquement, champs bornés. */
export function cleanLink(l) {
  const href = String(l?.href || '').trim();
  let u;
  try { u = new URL(href); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  return {
    id: String(l.id || newId('lnk')).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || newId('lnk'),
    label: String(l.label || u.hostname).trim().slice(0, 60),
    sub: String(l.sub || '').trim().slice(0, 80),
    href: u.toString().slice(0, 300),
    icon: LINK_ICONS.includes(l.icon) ? l.icon : 'link',
    private: Boolean(l.private),
  };
}

const clean = (items) => (Array.isArray(items) ? items : []).map(cleanLink).filter(Boolean).slice(0, 30);

const LS = 'links:v1';
/** Dernière liste PUBLIQUE reçue du serveur, gardée sur l'appareil. */
function stored() {
  try { const v = JSON.parse(localStorage.getItem(LS)); return Array.isArray(v) ? clean(v).map((l) => ({ ...l, private: false })) : null; } catch { return null; }
}
let cache = null;      // { items, admin, ok }
let loading = null;

const rerender = () => window.dispatchEvent(new Event('app:render'));

/** Liens à afficher (chargés une fois par session, rechargés si le rôle change ou après un échec). */
export function linksOf(isAdmin) {
  const admin = Boolean(isAdmin);
  if (!loading && (!cache || cache.admin !== admin || (!cache.ok && Date.now() - cache.at > 30_000))) load(admin);
  return cache?.items || stored() || DEFAULTS;
}

async function load(isAdmin) {
  loading = (async () => {
    try {
      const pub = await getDoc(doc(db, 'config', 'links'));
      let items = pub.exists() ? clean(pub.data().items).map((l) => ({ ...l, private: false })) : DEFAULTS;
      if (pub.exists()) { try { localStorage.setItem(LS, JSON.stringify(items)); } catch { /* ignoré */ } }
      if (isAdmin) {
        const priv = await getDoc(doc(db, 'config', 'linksPrivate'));
        if (priv.exists()) {
          const p = clean(priv.data().items).map((l) => ({ ...l, private: true }));
          const order = priv.data().order;       // ordre global choisi par l'admin
          items = [...items, ...p];
          if (Array.isArray(order)) items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        }
      }
      cache = { items, admin: isAdmin, ok: true, at: Date.now() };
    } catch (err) {
      console.warn('[links] lecture refusée ou hors ligne', err?.code || err);
      cache = { items: cache?.items || stored() || DEFAULTS, admin: isAdmin, ok: false, at: Date.now() };
    } finally {
      loading = null;
      rerender();
    }
  })();
}

/** ADMIN : enregistre la liste complète (publics + privés) en une écriture groupée. */
export async function saveLinks(items) {
  // Garde-fou : jamais d'enregistrement à partir de la liste par défaut affichée
  // quand le serveur n'a pas répondu (elle écraserait les vrais liens).
  if (!cache?.ok || !cache.admin) throw new Error('Liens pas encore chargés depuis le serveur : réessaie en ligne dans un instant.');
  const all = clean(items);
  const batch = writeBatch(db);
  batch.set(doc(db, 'config', 'links'), {
    items: all.filter((l) => !l.private).map(({ private: _, ...l }) => l), updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'config', 'linksPrivate'), {
    items: all.filter((l) => l.private).map(({ private: _, ...l }) => l),
    order: all.map((l) => l.id),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  try { localStorage.setItem(LS, JSON.stringify(all.filter((l) => !l.private))); } catch { /* ignoré */ }
  cache = { items: all, admin: true, ok: true, at: Date.now() };
  rerender();
}
