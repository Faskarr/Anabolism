/**
 * Images côté téléphone : chargement (orientation EXIF respectée) puis export
 * d'un carré en JPEG. Une photo iPhone de 3–5 Mo devient ~20–40 Ko (stockable
 * gratuitement dans Firestore, sans Cloud Storage).
 */

/** Charge un fichier image dans un <img> (orientation EXIF appliquée par le navigateur). */
export function loadImage(file) {
  if (!file || !file.type.startsWith('image/')) return Promise.reject(new Error('Choisis une image.'));
  if (file.size > 25 * 1024 * 1024) return Promise.reject(new Error('Image trop lourde (25 Mo max).'));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve({ img, url, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Format d’image non lisible (essaie une capture ou un JPEG).')); };
    img.src = url;
  });
}

/**
 * Exporte la zone carrée (sx, sy, side) de l'image, redimensionnée en `size` px.
 * Qualité abaissée si besoin pour rester sous la limite des règles (150 000 car.).
 */
export function cropJpeg(img, { sx, sy, side }, size = 256, quality = 0.84) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  for (let q = quality; q >= 0.5; q -= 0.08) {
    const data = canvas.toDataURL('image/jpeg', q);
    if (data.length < 140000) return data;
  }
  return canvas.toDataURL('image/jpeg', 0.5);
}

/** Carré centré (sans recadrage manuel). */
export async function squareJpeg(file, size = 256) {
  const { img, url, w, h } = await loadImage(file);
  try {
    const side = Math.min(w, h);
    return cropJpeg(img, { sx: (w - side) / 2, sy: (h - side) / 2, side }, size);
  } finally { URL.revokeObjectURL(url); }
}
