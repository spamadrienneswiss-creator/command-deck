// Reads any number of private calendar links (Google, Outlook, iCloud: any
// iCal/.ics feed), expands recurring events, and returns one merged list.
const ical = require('node-ical');

const cache = new Map(); // calId -> { events, fetchedAt }

function normalizeUrl(url) {
  return String(url || '').trim().replace(/^webcal:\/\//i, 'https://');
}

async function download(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(normalizeUrl(url), {
      headers: { 'User-Agent': 'CommandDeck/1.0', Accept: 'text/calendar, text/plain, */*' },
      signal: ctrl.signal,
      redirect: 'follow'
    });
    if (!res.ok) throw new Error(`The calendar server answered ${res.status}`);
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That link did not return a calendar (.ics) file');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function isAllDay(ev) {
  return ev.datetype === 'date' || (ev.start && ev.start.dateOnly === true);
}

// All-day dates must be read as calendar dates, not instants, or they slide
// a day in negative UTC offsets like California.
function localDateFromAllDay(d, viaUTC) {
  if (viaUTC) return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

function hasKey(map, d) {
  if (!map) return false;
  const k = dateKey(d);
  return Object.keys(map).some((x) => x.slice(0, 10) === k);
}

function getKey(map, d) {
  if (!map) return null;
  const k = dateKey(d);
  const hit = Object.keys(map).find((x) => x.slice(0, 10) === k);
  return hit ? map[hit] : null;
}

function expand(parsed, calId, rangeStart, rangeEnd) {
  const out = [];
  for (const key of Object.keys(parsed)) {
    const ev = parsed[key];
    if (!ev || ev.type !== 'VEVENT' || !ev.start) continue;
    if (ev.status && String(ev.status).toUpperCase() === 'CANCELLED') continue;

    const allDay = isAllDay(ev);
    const baseStart = new Date(ev.start);
    const baseEnd = ev.end ? new Date(ev.end) : new Date(baseStart.getTime() + (allDay ? 864e5 : 36e5));
    const duration = Math.max(0, baseEnd - baseStart);
    const title = typeof ev.summary === 'object' ? ev.summary.val : ev.summary;
    const location = typeof ev.location === 'object' ? ev.location.val : ev.location;

    const push = (start, end, src, id) => {
      let s = new Date(start);
      let e = new Date(end);
      if (allDay) {
        s = localDateFromAllDay(s, false);
        e = new Date(s.getTime() + Math.max(864e5, Math.round(duration / 864e5) * 864e5));
      }
      if (e <= rangeStart || s >= rangeEnd) return;
      out.push({
        id: `${calId}:${id}`,
        calId,
        title: String((src && (typeof src.summary === 'object' ? src.summary.val : src.summary)) || title || '(No title)'),
        location: location ? String(location) : '',
        start: s.toISOString(),
        end: e.toISOString(),
        allDay
      });
    };

    if (ev.rrule) {
      let dates = [];
      try {
        dates = ev.rrule.between(new Date(rangeStart.getTime() - duration - 864e5), new Date(rangeEnd.getTime() + 864e5), true);
      } catch (e) {
        dates = [];
      }
      for (const d of dates) {
        let occStart = new Date(d);
        if (allDay) occStart = localDateFromAllDay(d, true);
        const override = getKey(ev.recurrences, d);
        if (override) {
          if (override.status && String(override.status).toUpperCase() === 'CANCELLED') continue;
          const os = new Date(override.start);
          const oe = override.end ? new Date(override.end) : new Date(os.getTime() + duration);
          push(os, oe, override, `${ev.uid}:${dateKey(d)}`);
          continue;
        }
        if (hasKey(ev.exdate, d)) continue;
        push(occStart, new Date(occStart.getTime() + duration), null, `${ev.uid}:${dateKey(d)}`);
      }
    } else if (!ev.recurrenceid) {
      push(baseStart, baseEnd, null, ev.uid || key);
    }
  }
  return out;
}

async function fetchCalendars(calendars, rangeStart, rangeEnd) {
  const events = [];
  const errors = [];
  const enabled = calendars.filter((c) => c && c.enabled !== false && c.url);
  await Promise.all(enabled.map(async (cal) => {
    try {
      const text = await download(cal.url);
      const parsed = ical.sync.parseICS(text);
      const list = expand(parsed, cal.id, rangeStart, rangeEnd);
      cache.set(cal.id, { events: list, fetchedAt: Date.now() });
      events.push(...list);
    } catch (e) {
      errors.push({ calId: cal.id, name: cal.name, message: e.name === 'AbortError' ? 'The calendar took too long to answer' : e.message });
      const prev = cache.get(cal.id);
      if (prev) events.push(...prev.events); // keep showing the last good copy
    }
  }));
  events.sort((a, b) => new Date(a.start) - new Date(b.start));
  return { events, errors, fetchedAt: new Date().toISOString() };
}

module.exports = { fetchCalendars, expand };
