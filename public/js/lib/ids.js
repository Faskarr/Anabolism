/**
 * Identifiants uniques courts : préfixe + horodatage base36 + aléa.
 * Ex. uid('e') → 'e_lz3k9x_4f7q'. Compatibles avec les ids de l'ancienne app
 * (préfixe_chiffres) et sans point (utilisables comme chemin de champ Firestore).
 */
export function uid(prefix = 'id') {
  const rand = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 4);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}
