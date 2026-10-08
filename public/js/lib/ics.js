/**
 * Export des rappels vers l'app Calendrier (format iCalendar .ics, RFC 5545).
 *
 * Sans serveur, une PWA ne peut pas écrire directement dans le calendrier :
 * on génère un fichier .ics que iOS propose d'« Ajouter » (tous les événements
 * d'un coup, dans le calendrier de son choix).
 *
 *  • une série d'événements récurrents par produit (RRULE hebdomadaire) ;
 *  • heure « flottante » (sans fuseau) → toujours l'heure locale du téléphone ;
 *  • une alarme à l'heure exacte (VALARM) ;
 *  • UID stable par produit (anabolicos-<id>) pour repérer les doublons.
 */
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const pad = (n) => String(n).padStart(2, '0');

/** Échappement des textes iCalendar. */
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Pliage des lignes à 75 octets (continuation = espace en début de ligne). */
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const l = new TextEncoder().encode(ch).length;
    if (len + l > (out.length ? 74 : 75)) { out.push(cur); cur = ''; len = 0; }
    cur += ch; len += l;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const stamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const local = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

/** Première occurrence (aujourd'hui inclus si l'heure n'est pas passée). */
function firstOccurrence(weekdays, minutes, now = new Date()) {
  for (let i = 0; i < 8; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, Math.floor(minutes / 60), minutes % 60);
    const wd = ((d.getDay() + 6) % 7) + 1;
    if (weekdays.includes(wd) && d > now) return d;
  }
  return new Date(now.getTime() + 86400000);
}

/**
 * @param {Array<{ id:string, title:string, note?:string, weekdays:number[], minutes:number }>} reminders
 * @returns {string} contenu .ics
 */
export function buildICS(reminders, calName = 'AnabolicOS') {
  const now = new Date();
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AnabolicOS//Protocole//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(calName)}`,
  ];
  for (const r of reminders) {
    const wd = r.weekdays?.length ? [...r.weekdays].sort() : [1, 2, 3, 4, 5, 6, 7];
    const start = firstOccurrence(wd, r.minutes, now);
    const end = new Date(start.getTime() + 10 * 60000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:anabolicos-${r.id}@anabolic-adc6a.web.app`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${local(start)}`,
      `DTEND:${local(end)}`,
      wd.length === 7 ? 'RRULE:FREQ=DAILY' : `RRULE:FREQ=WEEKLY;BYDAY=${wd.map((d) => BYDAY[d - 1]).join(',')}`,
      `SUMMARY:${esc(`💊 ${r.title}`)}`,
      r.note ? `DESCRIPTION:${esc(r.note)}` : null,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(r.title)}`, 'TRIGGER:PT0M', 'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.filter(Boolean).map(fold).join('\r\n')}\r\n`;
}

/**
 * Ouvre le fichier dans iOS : la fiche « Ajouter au calendrier » s'affiche.
 * Repli : partage du fichier (Fichiers, AirDrop, Mail…).
 */
export async function openICS(content, filename = 'anabolicos-rappels.ics') {
  const file = new File([content], filename, { type: 'text/calendar' });
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function shareICS(content, filename = 'anabolicos-rappels.ics') {
  const file = new File([content], filename, { type: 'text/calendar' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'Rappels AnabolicOS' });
    return true;
  }
  await openICS(content, filename);
  return false;
}
