// Small shared helpers: dates, formatting, escaping, recurrence.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clone = (v) => JSON.parse(JSON.stringify(v));
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MON = MONTHS.map((m) => m.slice(0, 3).toUpperCase());

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
export function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / 864e5);
}

export function fmtTime(d, h24) {
  if (h24) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}
export function fmtTimeShort(d, h24) {
  if (h24) return fmtTime(d, true);
  const h = d.getHours() % 12 || 12;
  const ap = d.getHours() < 12 ? 'AM' : 'PM';
  return d.getMinutes() ? `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}` : `${h} ${ap}`;
}

export function dayLabel(d, now = new Date()) {
  const diff = daysBetween(now, d);
  if (diff === 0) return 'TODAY';
  if (diff === 1) return 'TOMORROW';
  if (diff === -1) return 'YESTERDAY';
  if (diff > 1 && diff < 7) return `${DOW[d.getDay()]} ${d.getDate()}`;
  return `${MON[d.getMonth()]} ${d.getDate()}`;
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function spokenDay(d, now = new Date()) {
  const diff = daysBetween(now, d);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff > 1 && diff < 7) return DAY_FULL[d.getDay()];
  return `${DAY_FULL[d.getDay()]}, ${MONTHS[d.getMonth()]} ${ordinal(d.getDate())}`;
}

export function toDateInput(d) {
  return d ? dayKey(new Date(d)) : '';
}
export function toTimeInput(d) {
  if (!d) return '';
  const x = new Date(d);
  return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
}
export function fromInputs(dateStr, timeStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const out = new Date(y, m - 1, d, 0, 0, 0, 0);
  if (timeStr) {
    const [hh, mm] = timeStr.split(':').map(Number);
    out.setHours(hh, mm, 0, 0);
  }
  return out;
}

export function partOfDay(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

// ---- Recurrence ----
export function advanceDate(date, rep) {
  const n = new Date(date);
  const iv = Math.max(1, rep.interval || 1);
  switch (rep.type) {
    case 'daily':
      n.setDate(n.getDate() + iv);
      break;
    case 'weekdays':
      do { n.setDate(n.getDate() + 1); } while (n.getDay() === 0 || n.getDay() === 6);
      break;
    case 'weekly':
      if (rep.days && rep.days.length && iv === 1) {
        do { n.setDate(n.getDate() + 1); } while (!rep.days.includes(n.getDay()));
      } else {
        n.setDate(n.getDate() + 7 * iv);
      }
      break;
    case 'monthly': {
      const day = n.getDate();
      n.setDate(1);
      n.setMonth(n.getMonth() + iv);
      const max = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
      n.setDate(Math.min(day, max));
      break;
    }
    case 'yearly':
      n.setFullYear(n.getFullYear() + iv);
      break;
    default:
      return null;
  }
  return n;
}

export function repeatLabel(rep) {
  if (!rep || rep.type === 'none') return '';
  const iv = rep.interval || 1;
  switch (rep.type) {
    case 'daily': return iv === 2 ? 'EVERY OTHER DAY' : iv > 1 ? `EVERY ${iv} DAYS` : 'DAILY';
    case 'weekdays': return 'WEEKDAYS';
    case 'weekly':
      if (iv === 2) return 'BIWEEKLY';
      if (rep.days && rep.days.length > 1) return rep.days.map((d) => DOW[d].slice(0, 2)).join('·');
      if (rep.days && rep.days.length === 1) return `EVERY ${DOW[rep.days[0]]}`;
      return 'WEEKLY';
    case 'monthly': return 'MONTHLY';
    case 'yearly': return 'YEARLY';
    default: return '';
  }
}

export function spokenRepeat(rep) {
  if (!rep || rep.type === 'none') return '';
  switch (rep.type) {
    case 'daily': return rep.interval === 2 ? 'every other day' : 'every day';
    case 'weekdays': return 'every weekday';
    case 'weekly':
      if (rep.interval === 2) return 'every other week';
      if (rep.days && rep.days.length) return 'every ' + rep.days.map((d) => DAY_FULL[d]).join(' and ');
      return 'every week';
    case 'monthly': return 'every month';
    case 'yearly': return 'every year';
    default: return '';
  }
}
