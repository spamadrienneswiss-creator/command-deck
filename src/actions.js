// Voice "action" commands: timers, alarms, snooze, confirmations and editing
// existing tasks. Returns null when the text isn't one of these.
const chrono = require('chrono-node');

const NUM = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, 'twenty five': 25, thirty: 30,
  forty: 40, 'forty five': 45, fifty: 50, sixty: 60, ninety: 90
};
const NUM_ALT = '\\d+(?:\\.\\d+)?|twenty five|forty five|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|ninety';
const UNIT_ALT = 'hours?|hrs?|minutes?|mins?|seconds?|secs?';
const DUR_RE = new RegExp(`\\b(${NUM_ALT})\\s*(${UNIT_ALT})\\b(\\s+and\\s+a\\s+half)?`, 'gi');

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '').trim();
}

function num(w) {
  const x = String(w).toLowerCase().replace(/-/g, ' ');
  if (/^\d+(\.\d+)?$/.test(x)) return parseFloat(x);
  return NUM[x] ?? null;
}

// "1 hour 30 minutes", "an hour and a half", "half an hour", "90 seconds" → seconds
function parseDuration(text) {
  let t = String(text).toLowerCase().replace(/-/g, ' ');
  let total = 0;
  let found = false;
  const spans = [];
  t = t.replace(/\bhalf an? hour\b/g, (m) => { total += 1800; found = true; spans.push(m); return ' '; });
  t = t.replace(/\ba (?:minute|min) and a half\b/g, (m) => { total += 90; found = true; spans.push(m); return ' '; });
  let m;
  DUR_RE.lastIndex = 0;
  while ((m = DUR_RE.exec(t))) {
    let n = num(m[1]);
    if (n == null) continue;
    if (m[3]) n += 0.5;
    const u = m[2].toLowerCase();
    total += u.startsWith('h') ? n * 3600 : u.startsWith('m') ? n * 60 : n;
    found = true;
    spans.push(m[0]);
  }
  return found ? { seconds: Math.round(total), spans } : null;
}

function stripSpans(text, spans) {
  let t = String(text).replace(/-/g, ' ');
  for (const s of spans) t = t.replace(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
  return clean(t);
}

function labelFrom(rest) {
  const t = clean(rest);
  const called = t.match(/^.*\b(?:called|named|labell?ed|for)\s+(?:the\s+|my\s+)?(.+)$/i);
  if (!called) return '';
  const lab = clean(called[1].replace(/\b(?:timer|alarm)\b/gi, '').replace(/^(?:and|the)\s+/i, ''));
  return lab.length > 40 ? lab.slice(0, 40) : lab;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Next future time for an alarm. Ambiguous hours ("at 7") pick the nearest
// upcoming one, except wake-ups, which mean the morning.
function alarmTime(comp, ref, wake) {
  const base = comp.date();
  const h = base.getHours();
  const m = base.getMinutes();
  const explicitDay = comp.isCertain('day') || comp.isCertain('weekday');
  if (comp.isCertain('meridiem') || h === 0 || h >= 13) {
    let d = new Date(base);
    if (!explicitDay && d <= ref) d.setDate(d.getDate() + 1);
    return d;
  }
  const hour12 = h % 12;
  const candidates = [];
  const day0 = explicitDay ? startOfDay(base) : startOfDay(ref);
  for (let add = 0; add < 3; add++) {
    for (const hh of wake ? [hour12] : [hour12, hour12 + 12]) {
      const c = new Date(day0);
      c.setDate(c.getDate() + add);
      c.setHours(hh, m, 0, 0);
      if (c > ref) candidates.push(c);
    }
  }
  candidates.sort((a, b) => a - b);
  return candidates[0] || base;
}

function parseTimerCommands(text, lower, ref) {
  // Cancel / stop
  const cancel = lower.match(/^(?:cancel|stop|clear|delete|remove|turn off|dismiss|kill)\s+(?:the\s+|my\s+|that\s+)?(all\s+)?(?:(.+?)\s+)?(timers?|alarms?)\b/);
  if (cancel) {
    return { intent: 'cancel-timer', all: !!cancel[1] || /s$/.test(cancel[3]), label: cancel[2] ? clean(cancel[2]) : '', kind: cancel[3].startsWith('alarm') ? 'alarm' : 'timer' };
  }
  // Query
  if (/\b(?:how (?:much|long) (?:time )?(?:is )?(?:left|remaining)|time left on|how long on the timer|check (?:the |my )?timers?|what timers?)\b/.test(lower)) {
    return { intent: 'timer-query' };
  }
  // Alarm
  if (/^(?:wake me(?: up)?|set (?:an |the |my )?alarm|alarm (?:at|for)|(?:make|create|add) (?:an |a )?alarm)\b/.test(lower) || /\balarm\s+(?:at|for)\b/.test(lower)) {
    const wake = /^wake me/.test(lower);
    const dur = parseDuration(text);
    if (dur && /\bin\s/.test(lower)) {
      return { intent: 'set-alarm', at: new Date(ref.getTime() + dur.seconds * 1000).toISOString(), label: labelFrom(stripSpans(text, dur.spans)), wake };
    }
    let results = chrono.parse(text, ref, { forwardDate: true });
    if (!results.length || !results[0].start.isCertain('hour')) {
      // Bare hours like "alarm for 5" or "wake me at 6" → read as a clock time.
      const bare = text.match(/\b(?:at|for)\s+(\d{1,2})(?::(\d{2}))?\b(?!\s*(?:minutes?|mins?|hours?|hrs?|seconds?|secs?))/i);
      if (bare) results = chrono.parse(`${text.slice(0, bare.index)} at ${bare[1]}:${bare[2] || '00'}${text.slice(bare.index + bare[0].length)}`, ref, { forwardDate: true });
    }
    if (!results.length || !results[0].start.isCertain('hour')) return { intent: 'set-alarm', at: null, wake };
    const r = results[0];
    const at = alarmTime(r.start, ref, wake);
    const rest = text.slice(0, r.index) + ' ' + text.slice(r.index + r.text.length);
    return { intent: 'set-alarm', at: at.toISOString(), label: labelFrom(rest), wake };
  }
  // Timer
  if (/\btimer\b/.test(lower) && !/^(?:add|create)\s+(?:a\s+)?task\b/.test(lower)) {
    const dur = parseDuration(text);
    if (!dur || !dur.seconds) return { intent: 'set-timer', seconds: null };
    const rest = stripSpans(text, dur.spans);
    return { intent: 'set-timer', seconds: dur.seconds, label: labelFrom(rest) };
  }
  return null;
}

function parseSnooze(text, lower) {
  if (/^snooze\b/.test(lower) || /^(?:remind me (?:again )?(?:in|after)|remind me again|give me (?:another\s+)?(?:\d+|a few|five|ten|fifteen)|again in)\b/.test(lower)) {
    if (/\bto\s+\w/.test(lower.replace(/^remind me (?:again )?(?:in|after)\s+[^]*?\b(?:minutes?|mins?|hours?|hrs?)\b/, ''))) return null; // "remind me in 10 minutes to X" is a new task
    const dur = parseDuration(text);
    return { intent: 'snooze', seconds: dur ? dur.seconds : null };
  }
  return null;
}

function parseConfirm(lower) {
  if (/^(?:yes|yeah|yep|yup|confirm(?:ed)?|affirmative|do it|go ahead|correct|sure|delete it|proceed)\b/.test(lower)) return { intent: 'confirm' };
  if (/^(?:no|nope|negative|don't|do not|keep it|cancel that|abort)\b/.test(lower)) return { intent: 'deny' };
  return null;
}

const PRI_WORDS = { high: 'high', top: 'high', urgent: 'high', medium: 'medium', normal: 'medium', mid: 'medium', low: 'low' };

function parseWhen(whenText, ref) {
  const results = chrono.parse(whenText, ref, { forwardDate: true });
  if (!results.length) return null;
  const comp = results[0].start;
  const hasTime = comp.isCertain('hour');
  let d = comp.date();
  if (hasTime) {
    if (!comp.isCertain('meridiem') && d.getHours() >= 1 && d.getHours() <= 6) d.setHours(d.getHours() + 12);
  } else {
    d = startOfDay(d);
  }
  return { due: d.toISOString(), dueHasTime: hasTime };
}

function parseEdits(text, lower, ctx, ref) {
  const categories = ctx.categories || [];
  const people = ctx.people || [];
  const catByName = (w) => categories.find((c) => c && c.name && c.name.toLowerCase() === clean(w).toLowerCase());
  const personByName = (w) => people.find((p) => p && p.toLowerCase() === clean(w).toLowerCase());
  const q = (s) => clean(String(s)
    .replace(/^(?:the\s+)?(?:task|event|item)\s+/i, '')
    .replace(/^the\s+/i, '')
    .replace(/\s+(?:from|off|on)\s+(?:my|the)\s+(?:task\s+|to-?do\s+)?(?:list|tasks|queue|calendar)$/i, ''));
  let m;

  // Priority: "make electric bill high priority", "set X to low", "mark X urgent"
  m = text.match(/^(?:make|set|mark|change|bump|switch)\s+(.+?)\s+(?:to\s+|as\s+|a\s+)?(high|top|urgent|medium|normal|mid|low)(?:[\s-]+priority)?$/i)
    || text.match(/^(?:make|set|mark|change)\s+(?:the\s+)?priority\s+(?:of|on|for)\s+(.+?)\s+(?:to\s+)?(high|top|urgent|medium|normal|mid|low)$/i);
  if (m) return { intent: 'edit-task', action: 'priority', query: q(m[1]), priority: PRI_WORDS[m[2].toLowerCase()], fallback: /^(?:make|set)/i.test(text) };

  // Delete: "delete book flights", "remove the task X"
  m = text.match(/^(?:delete|remove|scrap|trash|erase|get rid of|cancel)\s+(.+)$/i);
  if (m && !/\b(?:timers?|alarms?)\b/i.test(m[1])) return { intent: 'edit-task', action: 'delete', query: q(m[1]) };

  // Assign: "assign X to Nick", "give X to Alex", "unassign X"
  m = text.match(/^(?:assign|give|hand)\s+(.+?)\s+to\s+(.+)$/i);
  if (m && personByName(m[2])) return { intent: 'edit-task', action: 'assign', query: q(m[1]), assignee: personByName(m[2]) };
  m = text.match(/^unassign\s+(.+)$/i);
  if (m) return { intent: 'edit-task', action: 'assign', query: q(m[1]), assignee: null };

  // Move / reschedule / category: "move call Sam to Friday at 2", "move X to work"
  m = text.match(/^(?:move|reschedule|push|shift|change|put|file|bump)\s+(.+?)\s+(?:to|until|till|for|into|under|in)\s+(?:the\s+)?(.+?)(?:\s+(?:category|list|tag))?$/i);
  if (m) {
    const cat = catByName(m[2]);
    if (cat) return { intent: 'edit-task', action: 'category', query: q(m[1]), category: cat.id, fallback: /^put/i.test(text) };
    const when = parseWhen(m[2], ref);
    if (when) return { intent: 'edit-task', action: 'reschedule', query: q(m[1]), ...when, fallback: /^put/i.test(text) };
  }
  return null;
}

function parseAction(text, ctx = {}, ref = new Date()) {
  const lower = text.toLowerCase();
  return parseTimerCommands(text, lower, ref)
    || parseSnooze(text, lower)
    || parseConfirm(lower)
    || (ctx.noEdit ? null : parseEdits(text, lower, ctx, ref));
}

module.exports = { parseAction, parseDuration };
