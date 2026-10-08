/**
 * TRADUCTION FR → EN (français par défaut).
 *
 * Principe : l'app reste écrite en français ; la traduction se fait À L'AFFICHAGE.
 *  • tx('Enregistrer')   → 'Save' en anglais (chaînes fixes).
 *    Appelé automatiquement par h() pour les textes et les attributs visibles
 *    (aria-label, placeholder, title, alt) : les vues n'ont rien à faire.
 *  • T`${n} séance${s}`  → gabarit avec valeurs : la clé est le texte avec des
 *    emplacements {0}, {1}… ('{0} séance{1}') et la traduction peut les réordonner.
 *  • locale() / num()    → dates et nombres au format de la langue.
 *
 * Les DONNÉES (Firestore, champs de saisie, valeurs comparées) ne sont jamais
 * traduites : seul ce qui est affiché l'est. Un élément créé avec
 * h(…, { translate: 'no' }) garde son texte tel quel (messages, notes…).
 *
 * Le dictionnaire anglais (i18n-en.js) n'est chargé QUE si l'app est en anglais.
 */
const KEY = 'lang';

function readLang() {
  try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'fr'; } catch { return 'fr'; }
}

let lang = readLang();
let EN = null;   // { s: { fr: en }, t: { gabarit: en } }

/** Charge le dictionnaire si besoin (à attendre avant le premier affichage). */
export const langReady = load(lang);

async function load(l) {
  if (l === 'en' && !EN) {
    try { EN = (await import('./i18n-en.js')).default; } catch (err) {
      console.warn('[i18n] dictionnaire indisponible, retour au français', err);
      l = 'fr';
    }
  }
  lang = l;
  document.documentElement.lang = l;
}

export const getLang = () => lang;
export const isEn = () => lang === 'en' && EN !== null;
export const locale = () => (isEn() ? 'en-US' : 'fr-FR');

/** Change la langue (mémorisée sur l'appareil) puis redessine l'app. */
export async function setLang(l) {
  const next = l === 'en' ? 'en' : 'fr';
  try { localStorage.setItem(KEY, next); } catch { /* stockage indisponible : vaut pour la session */ }
  await load(next);
  window.dispatchEvent(new Event('app:render'));
}

/** Chaîne fixe → traduction (ou la chaîne d'origine si inconnue). */
export function tx(s) {
  if (lang !== 'en' || !EN || typeof s !== 'string' || !s) return s;
  const hit = EN.s[s];
  if (hit !== undefined) return hit;
  // Espaces autour (« Toi : », « · actif ») : on traduit le cœur et on les remet.
  const core = s.trim();
  if (core !== s && EN.s[core] !== undefined) return s.replace(core, EN.s[core]);
  // Saisies des utilisateurs (« petit dejeuner », « PETIT-DÉJEUNER »…) : comparaison
  // sans accents, majuscules, tirets ni apostrophes typographiques.
  if (core.length <= 60) {
    const hit2 = loose().get(norm(core));
    if (hit2 !== undefined) return s.replace(core, matchCase(core, hit2));
  }
  return s;
}

/** « Petit-Déjeuner » → « petit dejeuner » (clé de comparaison tolérante). */
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[’`]/g, "'").replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

let LOOSE = null;
function loose() {
  if (!LOOSE) {
    LOOSE = new Map();
    for (const [k, v] of Object.entries(EN.s)) {
      const n = norm(k);
      if (n && !LOOSE.has(n)) LOOSE.set(n, v);
    }
  }
  return LOOSE;
}

/** Reprend la casse de la saisie : tout en majuscules, ou première lettre en minuscule. */
function matchCase(src, out) {
  if (src.length > 1 && src === src.toUpperCase() && src !== src.toLowerCase()) return out.toUpperCase();
  if (src[0] && src[0] === src[0].toLowerCase() && src[0] !== src[0].toUpperCase()) return out[0].toLowerCase() + out.slice(1);
  return out;
}

/** Gabarit traduit : T`Supprimer « ${nom} » ?` */
export function T(strings, ...vals) {
  if (lang !== 'en' || !EN) return String.raw({ raw: strings }, ...vals);
  const key = strings.reduce((acc, part, i) => acc + part + (i < vals.length ? `{${i}}` : ''), '');
  const v = vals.map((x) => (typeof x === 'string' ? tx(x) : x));
  const tpl = EN.t[key];
  if (tpl === undefined) return String.raw({ raw: strings }, ...v);
  return tpl.replace(/\{(\d+)\}/g, (_, i) => String(v[i] ?? ''));
}

/** Nombre décimal dans le format de la langue : 82.5 → « 82,5 » / « 82.5 ». */
export function num(n, decimals = 1) {
  const s = Number(n).toFixed(decimals);
  return isEn() ? s : s.replace('.', ',');
}
