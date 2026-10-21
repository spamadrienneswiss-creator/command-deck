// Natural-language command parser for the ship's computer.
// Turns "call Sam Thursday at 3, high priority, work" into a structured task.
const chrono = require('chrono-node');
const { parseAction } = require('./actions');

const NUM_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, 'twenty-five': 25, thirty: 30,
  forty: 40, 'forty-five': 45, fifty: 50, sixty: 60, ninety: 90
};
const DAY_PREFIX = [['sun', 0], ['mon', 1], ['tue', 2], ['wed', 3], ['thu', 4], ['fri', 5], ['sat', 6]];
const DAY_ALT = '(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?s?';
const CREATE_START = /^(?:add|create|make|log|put|new|set up|set|schedule|book|remind me|i need to|i have to|i've got to|i gotta|don't forget|need to|gotta)\b/i;
const EVENING_WORDS = /\b(?:dinner|supper|tonight|night|evening|party|drinks|movie|show|concert|date night|game night)\b/i;

function clean(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/,\s*,+/g, ',')
    .replace(/^[\s,.;:-]+|[\s,;:-]+$/g, '')
    .trim();
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toNumber(word) {
  const w = String(word).toLowerCase();
  if (/^\d+(\.\d+)?$/.test(w)) return parseFloat(w);
  return NUM_WORDS[w] ?? null;
}

function toMinutes(n, unit) {
  const u = String(unit).toLowerCase();
  if (u.startsWith('h')) return Math.round(n * 60);
  if (u.startsWith('d')) return Math.round(n * 1440);
  return Math.round(n);
}

function dayIndex(word) {
  const w = word.toLowerCase();
  const hit = DAY_PREFIX.find(([p]) => w.startsWith(p));
  return hit ? hit[1] : null;
}

// Remove the first match of `re` from text, calling fn(match) if found.
function take(text, re, fn) {
  const m = text.match(re);
  if (!m) return text;
  fn(m);
  return clean(text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length));
}

function stripWake(text) {
  let t = text;
  t = t.replace(/^(?:hey|ok|okay)?\s*computer[,.:!]?\s+/i, '');
  for (let i = 0; i < 2; i++) t = t.replace(/^(?:please|can you|could you|would you|will you|go ahead and)\s+/i, '');
  return clean(t);
}

function classifyQuery(lower) {
  if (/\b(?:brief(?:ing)?|status report|sitrep|my day|day look|agenda|rundown|what(?:'s| is) (?:on )?(?:for )?today)\b/.test(lower)) return 'briefing';
  if (/\b(?:weather|forecast|temperature|going to rain|is it (?:hot|cold))\b/.test(lower)) return 'weather';
  if (/\bnext (?:event|meeting|appointment)\b|^what(?:'s| is) next\b/.test(lower)) return 'next-event';
  if (/\b(?:what(?:'s| is) (?:on )?my (?:list|tasks|to-?do(?: list)?)|list (?:my )?tasks|what(?:'s| is) due|what do i (?:have|need) to do|my tasks)\b/.test(lower)) return 'list-tasks';
  if (/^(?:what time is it|what(?:'s| is) the time|time check|current time)\b/.test(lower)) return 'time';
  if (/^(?:what(?:'s| is) (?:the |today'?s )?date|what day is (?:it|today))\b/.test(lower)) return 'date';
  if (/^(?:thank you|thanks|cheers|nice|good job|well done)\b/.test(lower)) return 'thanks';
  if (/^(?:never ?mind|cancel|stop|forget it)\b/.test(lower)) return 'cancel';
  return null;
}

function matchComplete(text) {
  const patterns = [
    /^(?:mark|set)\s+(?:the\s+)?(?:task\s+)?(.+?)\s+(?:as\s+)?(?:done|complete|completed|finished)$/i,
    /^(?:check|cross|tick)\s+off\s+(?:the\s+)?(?:task\s+)?(.+)$/i,
    /^(?:i\s+)?(?:just\s+)?(?:finished|completed|am done with|'m done with|done with)\s+(?:the\s+)?(?:task\s+)?(.+)$/i,
    /^(?:the\s+)?(?:task\s+)?(.+?)\s+is\s+(?:done|complete|finished)$/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return clean(m[1]);
  }
  return null;
}

function isEventRequest(lower) {
  if (/\b(?:on|to|in|into|onto)\s+(?:the|my)\s+calendar\b/.test(lower)) return true;
  if (/^schedule\b/.test(lower)) return true;
  if (/^book\b.*\b(?:appointment|meeting|reservation|table)\b/.test(lower)) return true;
  if (/^(?:add|create|make|put|new|set up)\s+(?:an?\s+)?(?:new\s+)?(?:event|appointment|meeting|calendar event)\b/.test(lower)) return true;
  return false;
}

function extractPriority(text, out) {
  const map = (w) => (/^(?:high|top|urgent)$/i.test(w) ? 'high' : /^low$/i.test(w) ? 'low' : 'medium');
  text = take(text, /\b(?:(?:at|with|as)\s+)?(?:a\s+)?(high|top|urgent|medium|normal|mid|low)[\s-]+priority\b/i, (m) => { out.priority = map(m[1]); });
  if (!out.priority) text = take(text, /\bpriority\s*(?:is\s+|of\s+|:\s*)?(high|top|medium|normal|mid|low)\b/i, (m) => { out.priority = map(m[1]); });
  if (!out.priority) text = take(text, /\b(?:it'?s\s+)?(?:urgent(?:ly)?|asap|a\.s\.a\.p\.?|top priority|important)\b/i, () => { out.priority = 'high'; });
  return text;
}

function extractReminder(text, out, defaultReminder) {
  text = take(text, /\b(?:and\s+)?remind me\s+half an? hour\s+(?:before|ahead|early|prior)\b/i, () => { out.reminder = 30; });
  if (out.reminder == null) {
    text = take(text, /\b(?:and\s+|with\s+(?:a\s+)?)?(?:remind(?:er)?(?:\s+me)?)\s+(\d+|an?|one|two|three|five|ten|fifteen|twenty|thirty|forty-five|sixty)\s*(minutes?|mins?|hours?|hrs?|days?)\s+(?:before|ahead|early|prior|in advance)\b/i,
      (m) => { out.reminder = toMinutes(toNumber(m[1]) || 1, m[2]); });
  }
  if (out.reminder == null) {
    text = take(text, /\b(?:and\s+)?(?:with\s+(?:a\s+)?reminder|remind me)\b/i, () => { out.reminder = defaultReminder; });
  }
  return text;
}

function extractRepeat(text, out) {
  const listRe = new RegExp(`\\b(?:every|each)\\s+(${DAY_ALT}(?:\\s*(?:,|and|&)\\s*${DAY_ALT})*)\\b`, 'i');
  const rules = [
    [/\bevery\s+other\s+day\b/i, () => ({ type: 'daily', interval: 2 })],
    [/\b(?:every\s+weekday|on\s+weekdays|weekdays|every\s+work\s*day)\b/i, () => ({ type: 'weekdays' })],
    [/\b(?:every\s+day|daily|each\s+day|every\s+(?:morning|night|evening|afternoon))\b/i, () => ({ type: 'daily' })],
    [/\b(?:every\s+other\s+week|biweekly|every\s+two\s+weeks|fortnightly)\b/i, () => ({ type: 'weekly', interval: 2 })],
    [listRe, (m) => {
      const days = m[1].split(/\s*(?:,|and|&)\s*/i).map(dayIndex).filter((d) => d != null);
      return { type: 'weekly', days: [...new Set(days)].sort() };
    }],
    [new RegExp(`\\b(${'(?:mon|tues|wednes|thurs|fri|satur|sun)day'}s)\\b`, 'i'), (m) => ({ type: 'weekly', days: [dayIndex(m[1])] })],
    [/\b(?:every\s+week|weekly|each\s+week|once\s+a\s+week)\b/i, () => ({ type: 'weekly' })],
    [/\b(?:every\s+month|monthly|each\s+month|once\s+a\s+month)\b/i, () => ({ type: 'monthly' })],
    [/\b(?:every\s+year|yearly|annually|each\s+year|once\s+a\s+year)\b/i, () => ({ type: 'yearly' })]
  ];
  for (const [re, build] of rules) {
    const m = text.match(re);
    if (m) {
      out.repeat = { interval: 1, days: [], ...build(m) };
      return clean(text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length));
    }
  }
  return text;
}

function extractAssignee(text, out, people) {
  for (const name of people) {
    if (!name) continue;
    const n = escapeRe(name);
    const re = new RegExp(`\\b(?:and\\s+)?(?:assign(?:ed)?\\s+(?:it\\s+|this\\s+)?to|give\\s+(?:it\\s+|this\\s+)?to|for|owner\\s*:?)\\s+${n}\\b`, 'i');
    const before = text;
    text = take(text, re, () => { out.assignee = name; });
    if (text !== before) break;
  }
  return text;
}

// "…to the holiday party project", "for project garage cleanout".
// Known projects match by name; an unknown name is passed on so the app can start it.
function extractProject(text, out, projects) {
  const named = [
    /\b(?:to|in|into|for|under|on|onto)\s+(?:the\s+|my\s+)?(.+?)\s+project\b/i,
    /\b(?:to|in|into|for|under|on)\s+project\s+(.+?)(?=\s*(?:,|;|$|\b(?:by|on|at|due|every|tomorrow|today|next|this)\b))/i
  ];
  for (const re of named) {
    const m = text.match(re);
    if (!m) continue;
    const said = m[1].trim().replace(/^(?:the|my)\s+/i, '');
    const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const hit = projects.find((p) => p && p.name && norm(p.name) === norm(said))
      || projects.find((p) => p && p.name && (norm(p.name).includes(norm(said)) || norm(said).includes(norm(p.name))));
    if (hit) out.projectId = hit.id; else out.projectName = said.charAt(0).toUpperCase() + said.slice(1);
    return clean(text.replace(m[0], ' '));
  }
  return text;
}

function extractCategory(text, out, categories) {
  for (const cat of categories) {
    if (!cat || !cat.name) continue;
    const n = escapeRe(cat.name);
    const res = [
      new RegExp(`\\b(?:(?:in|under|for|to|on|into)\\s+)?(?:the\\s+|my\\s+)?${n}\\s+(?:category|tag|list|label|bucket)\\b`, 'i'),
      new RegExp(`\\b(?:category|tag|tagged|label|labeled|labelled)\\s*(?:as\\s+|it\\s+|:\\s*)?(?:the\\s+)?${n}\\b`, 'i'),
      new RegExp(`\\b(?:for|under)\\s+${n}\\b`, 'i')
    ];
    for (const re of res) {
      const before = text;
      text = take(text, re, () => { out.category = cat.id; });
      if (text !== before) return text;
    }
  }
  return text;
}

// Comma-separated tails like ", high priority, work, Nick" are field lists.
function extractSegments(text, out, categories, people) {
  const parts = text.split(/\s*[,;]\s*/);
  if (parts.length < 2) return text;
  const keep = [parts[0]];
  for (const raw of parts.slice(1)) {
    const seg = raw.toLowerCase().replace(/^(?:and|the|tag|category|for|assign(?:ed)? to)\s+/, '').trim();
    const cat = categories.find((c) => c && c.name && c.name.toLowerCase() === seg);
    const person = people.find((p) => p && p.toLowerCase() === seg);
    if (cat && !out.category) { out.category = cat.id; continue; }
    if (person && !out.assignee) { out.assignee = person; continue; }
    keep.push(raw);
  }
  return keep.join(', ');
}

function fixMeridiem(date, comp, title) {
  if (comp.isCertain('meridiem')) return date;
  const h = date.getHours();
  const d = new Date(date);
  if (h >= 1 && h <= 6) d.setHours(h + 12);
  else if (h >= 7 && h <= 11 && EVENING_WORDS.test(title)) d.setHours(h + 12);
  return d;
}

function extractDate(text, out, ref) {
  const results = chrono.parse(text, ref, { forwardDate: true });
  if (!results.length) return text;
  const r = results[0];
  let before = text.slice(0, r.index);
  const after = text.slice(r.index + r.text.length);
  before = before.replace(/\b(?:due\s+(?:on|by)?|on|at|by|before|for|from|starting|this coming)\s*$/i, '');
  out._chrono = r;
  return clean(before + ' ' + after);
}

function finalizeTitle(text) {
  let t = clean(text)
    .replace(/^(?:to|that|about|called|named|saying)\s+/i, '')
    .replace(/\s+(?:on|at|by|due|and|to|for|with)$/i, '')
    .replace(/^["'“‘]+|["'”’]+$/g, '');
  t = clean(t);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Next date (today or later) falling on one of `days`, keeping the time of `base`.
function nextOnDays(base, days, ref) {
  const d = new Date(base);
  for (let i = 0; i < 8; i++) {
    const c = new Date(d);
    c.setDate(d.getDate() + i);
    if (days.includes(c.getDay()) && c >= ref) return c;
  }
  return d;
}

function parseTask(body, ctx, ref) {
  const out = { priority: null, reminder: null, repeat: null, assignee: null, category: null };
  const categories = ctx.categories || [];
  const people = ctx.people || [];
  let t = body;

  t = t.replace(/^remind me (?:to|that|about)\s+/i, () => { out.reminder = ctx.defaultReminder ?? 15; return ''; });
  t = t.replace(/^(?:add|create|make|log|put|new|set up|set)\s+/i, '');
  t = t.replace(/^(?:me\s+)?(?:a|an)?\s*(?:new\s+)?(?:task|to-?do|todo|reminder|item)s?\b\s*/i, '');
  t = t.replace(/^(?::|to\s+(?=\w)|called\s+|named\s+|that says\s+|saying\s+)/i, '');
  t = t.replace(/^(?:i need to|i have to|i've got to|i gotta|i must|don't forget to|need to|gotta)\s+/i, '');
  t = t.replace(/\s+(?:to|on|onto)\s+(?:my|the)\s+(?:task\s+|to-?do\s+)?(?:list|tasks|queue)\b/i, '');
  t = clean(t);

  t = extractPriority(t, out);
  t = extractReminder(t, out, ctx.defaultReminder ?? 15);
  t = extractRepeat(t, out);
  t = extractProject(t, out, ctx.projects || []);
  t = extractAssignee(t, out, people);
  t = extractCategory(t, out, categories);
  t = extractSegments(t, out, categories, people);
  t = extractDate(t, out, ref);

  const title = finalizeTitle(t) || 'Untitled task';
  let due = null;
  let dueHasTime = false;
  if (out._chrono) {
    const comp = out._chrono.start;
    dueHasTime = comp.isCertain('hour');
    let d = comp.date();
    if (dueHasTime) d = fixMeridiem(d, comp, title);
    else d = startOfDay(d);
    due = d;
  }
  if (out.repeat && !due) {
    if (out.repeat.type === 'weekly' && out.repeat.days.length) {
      due = startOfDay(nextOnDays(ref, out.repeat.days, startOfDay(ref)));
    } else {
      due = startOfDay(ref);
    }
  }
  if (out.repeat && out.repeat.type === 'weekly' && out.repeat.days.length && due && !out.repeat.days.includes(due.getDay())) {
    due = nextOnDays(due, out.repeat.days, startOfDay(due));
  }
  if (out.repeat && out.repeat.type === 'weekly' && !out.repeat.days.length && due) {
    out.repeat.days = [due.getDay()];
  }
  if (out.reminder != null && due && dueHasTime && due.getTime() - out.reminder * 60000 <= ref.getTime()) {
    out.reminder = 0; // due sooner than the usual heads-up: remind at the due time
  }
  if (out.reminder != null && !due) {
    // A reminder needs a due time; default to today, one hour from now.
    due = new Date(ref.getTime() + 60 * 60 * 1000);
    due.setMinutes(Math.ceil(due.getMinutes() / 15) * 15, 0, 0);
    dueHasTime = true;
  }
  return {
    title,
    due: due ? due.toISOString() : null,
    dueHasTime,
    priority: out.priority || 'medium',
    category: out.category,
    assignee: out.assignee,
    reminder: out.reminder,
    repeat: out.repeat || { type: 'none', interval: 1, days: [] },
    projectId: out.projectId || null,
    projectName: out.projectName || null
  };
}

function parseEvent(body, ctx, ref) {
  const out = {};
  let t = body;
  t = t.replace(/^(?:add|create|put|schedule|book|set up|make|new)\s+/i, '');
  t = t.replace(/^(?:an?\s+)?(?:new\s+)?(?:calendar\s+)?(?:event|appointment|meeting)?\s*(?:for|called|named|:)?\s*/i, '');
  t = t.replace(/\s*\b(?:on|to|in|into|onto)\s+(?:the|my)\s+calendar\b/i, ' ');
  t = clean(t);

  let allDay = false;
  t = take(t, /\b(?:all[\s-]day|the whole day)\b/i, () => { allDay = true; });
  let durationMin = null;
  t = take(t, /\bfor\s+(\d+(?:\.\d+)?|an?|one|two|three|four|five)\s*(hours?|hrs?|minutes?|mins?)\b/i, (m) => {
    durationMin = toMinutes(toNumber(m[1]) || 1, m[2]);
  });
  t = take(t, /\bfor\s+half an? hour\b/i, () => { durationMin = 30; });
  t = extractDate(t, out, ref);
  const title = finalizeTitle(t) || 'New event';

  if (!out._chrono) {
    return { title, start: null, end: null, allDay, missing: 'date' };
  }
  const comp = out._chrono.start;
  const hasTime = comp.isCertain('hour') && !allDay;
  let start = comp.date();
  let end;
  if (!hasTime) {
    start = startOfDay(start);
    end = new Date(start);
    end.setDate(end.getDate() + 1);
    allDay = true;
  } else {
    start = fixMeridiem(start, comp, title);
    if (out._chrono.end) {
      end = fixMeridiem(out._chrono.end.date(), out._chrono.end, title);
      if (end <= start) end = new Date(start.getTime() + 60 * 60 * 1000);
    } else {
      end = new Date(start.getTime() + (durationMin || 60) * 60 * 1000);
    }
  }
  return { title, start: start.toISOString(), end: end.toISOString(), allDay };
}

// "Take a note: gate code is 1357", "note that the plumber comes Friday",
// "jot this down: oat milk, basil". Everything after the cue becomes the note.
const NOTE_CUE = /^(?:please\s+)?(?:(?:take|make|add|save|create|start)\s+(?:a\s+|the\s+|new\s+)?note(?:\s+(?:that|saying|of|about))?|new\s+note|note(?:\s+that|\s*:)|(?:jot|write)\s+(?:this|that|it)?\s*down|log\s+(?:a\s+)?note)\s*[:,-]?\s*/i;

function parseNote(text) {
  const m = text.match(NOTE_CUE);
  if (!m) return null;
  const body = text.slice(m[0].length).trim();
  if (!body) return { intent: 'add-note', note: null };
  const full = body.charAt(0).toUpperCase() + body.slice(1);
  const words = full.split(/\s+/);
  let title = full.split(/[.,;:]/)[0].trim();
  if (title.length > 40 || !title) title = words.slice(0, 6).join(' ');
  if (title.length > 40) title = `${title.slice(0, 38).trim()}…`;
  return { intent: 'add-note', note: { title, body: full } };
}

function parseCommand(raw, ctx = {}, ref = new Date()) {
  const text = stripWake(clean(String(raw || '')).replace(/[.!?]+$/, ''));
  if (!text) return { intent: 'empty' };
  const lower = text.toLowerCase();

  const humor = lower.match(/\bhumou?r(?:\s+(?:setting|level))?\s*(?:to|at|is|=)?\s*(\d{1,3})\s*(?:%|percent)?/);
  if (humor) return { intent: 'set-humor', value: Math.min(100, Number(humor[1])) };
  if (/\b(?:what(?:'s| is)|how much is)\s+(?:your|the)\s+humou?r(?:\s+(?:setting|level))?\b/.test(lower)) return { intent: 'humor-query' };

  const note = parseNote(text);
  if (note) return note;

  // "new project garage cleanout", "start a project called holiday party"
  const np = text.match(/^(?:please\s+)?(?:start|create|make|add|begin|new)\s+(?:a\s+)?(?:new\s+)?project(?:\s+(?:called|named))?\s*[:,-]?\s*(.+)$/i);
  if (np) return { intent: 'add-project', name: np[1].trim().replace(/^./, (c) => c.toUpperCase()) };
  // "how's the holiday party project", "project status garage"
  const ps = lower.match(/^(?:how(?:'?s| is| are)\s+(?:the\s+|my\s+)?(.+?)\s+project(?:\s+(?:going|doing|coming along))?|(?:project\s+status|status\s+of\s+(?:the\s+)?)(?:\s+(?:for|on))?\s*(.+?)(?:\s+project)?)$/);
  if (ps) return { intent: 'project-status', query: (ps[1] || ps[2] || '').trim() };
  if (/^(?:what are my projects|list (?:my )?projects|my projects|projects)$/.test(lower)) return { intent: 'list-projects' };

  const action = parseAction(text, ctx, ref);
  if (action) return action;

  if (!CREATE_START.test(lower)) {
    const q = classifyQuery(lower);
    if (q) return { intent: q };
    const done = matchComplete(text);
    if (done) return { intent: 'complete-task', query: done };
  }

  if (isEventRequest(lower)) {
    return { intent: 'add-event', event: parseEvent(text, ctx, ref) };
  }
  return { intent: 'add-task', task: parseTask(text, ctx, ref) };
}

module.exports = { parseCommand };
