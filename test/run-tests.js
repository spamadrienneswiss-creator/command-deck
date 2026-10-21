// Parser and calendar checks. Run with: npm test
process.env.TZ = process.env.TZ || 'America/Los_Angeles';
const assert = require('assert');
const { parseCommand } = require('../src/commands');
const { expand } = require('../src/calendar');
const ical = require('node-ical');

const ctx = {
  categories: [{ id: 'home', name: 'Home' }, { id: 'work', name: 'Work' }, { id: 'errands', name: 'Errands' }],
  people: ['Me', 'Sam', 'Alex'],
  defaultReminder: 15
};
const ref = new Date(2026, 9, 12, 14, 30); // Mon Oct 12 2026, 2:30 PM local
let pass = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log('  ok ', name); } catch (e) { console.error('  FAIL', name, '\n      ', e.message); process.exitCode = 1; }
};
const local = (iso) => new Date(iso);

console.log('Command parser');
check('task with day, time, priority and category', () => {
  const r = parseCommand('Call Sam Thursday at 3, high priority, work', ctx, ref);
  assert.strictEqual(r.intent, 'add-task');
  assert.strictEqual(r.task.title, 'Call Sam');
  assert.strictEqual(r.task.priority, 'high');
  assert.strictEqual(r.task.category, 'work');
  const d = local(r.task.due);
  assert.strictEqual(d.getDay(), 4);
  assert.strictEqual(d.getHours(), 15);
});
check('remind me + weekly repeat lands on the named day', () => {
  const r = parseCommand('Remind me to take out the trash every Tuesday at 7pm', ctx, ref);
  assert.strictEqual(r.task.title, 'Take out the trash');
  assert.strictEqual(r.task.reminder, 15);
  assert.deepStrictEqual(r.task.repeat.days, [2]);
  assert.strictEqual(local(r.task.due).getDay(), 2);
});
check('assignee', () => {
  const r = parseCommand('Pay the electric bill by October 20th assign to Sam', ctx, ref);
  assert.strictEqual(r.task.assignee, 'Sam');
  assert.strictEqual(r.task.title, 'Pay the electric bill');
  assert.strictEqual(r.task.dueHasTime, false);
});
check('commas inside a title survive', () => {
  const r = parseCommand('Buy milk, eggs, bread', ctx, ref);
  assert.strictEqual(r.task.title, 'Buy milk, eggs, bread');
});
check('"book flights" is a task, not an event', () => {
  assert.strictEqual(parseCommand('Book flights for December', ctx, ref).intent, 'add-task');
});
check('event on the calendar with evening meridiem', () => {
  const r = parseCommand('Put dinner with Sam on the calendar Saturday at 7', ctx, ref);
  assert.strictEqual(r.intent, 'add-event');
  assert.strictEqual(r.event.title, 'Dinner with Sam');
  assert.strictEqual(local(r.event.start).getHours(), 19);
});
check('event with a range', () => {
  const r = parseCommand('Schedule dentist appointment next Wednesday from 2 to 3pm', ctx, ref);
  assert.strictEqual(local(r.event.start).getHours(), 14);
  assert.strictEqual(local(r.event.end).getHours(), 15);
});
check('event duration', () => {
  const r = parseCommand('Add team meeting to my calendar tomorrow at 10am for 2 hours', ctx, ref);
  assert.strictEqual((local(r.event.end) - local(r.event.start)) / 36e5, 2);
});
check('queries', () => {
  assert.strictEqual(parseCommand("What's my day look like?", ctx, ref).intent, 'briefing');
  assert.strictEqual(parseCommand("what's the weather", ctx, ref).intent, 'weather');
  assert.strictEqual(parseCommand("what's on my list", ctx, ref).intent, 'list-tasks');
});
check('complete a task', () => {
  const r = parseCommand('mark pay electric bill as done', ctx, ref);
  assert.strictEqual(r.intent, 'complete-task');
  assert.strictEqual(r.query, 'pay electric bill');
});

check('humor setting', () => {
  const r = parseCommand('set humor to 75 percent', ctx, ref);
  assert.strictEqual(r.intent, 'set-humor');
  assert.strictEqual(r.value, 75);
  assert.strictEqual(parseCommand('Humor setting 0%', ctx, ref).value, 0);
  assert.strictEqual(parseCommand("what's your humor setting", ctx, ref).intent, 'humor-query');
});

console.log('Timers, alarms, snooze and edits');
const evening = new Date(2026, 9, 12, 19, 30);
check('timers with durations and labels', () => {
  const a = parseCommand('Set a timer for 10 minutes', ctx, evening);
  assert.strictEqual(a.intent, 'set-timer');
  assert.strictEqual(a.seconds, 600);
  const b = parseCommand('timer for one hour and thirty minutes for the roast', ctx, evening);
  assert.strictEqual(b.seconds, 5400);
  assert.strictEqual(b.label, 'roast');
  assert.strictEqual(parseCommand('set a timer for an hour and a half', ctx, evening).seconds, 5400);
});
check('alarms pick the next sensible time', () => {
  const w = local(parseCommand('Wake me at 7', ctx, evening).at);
  assert.strictEqual(w.getDate(), 13);
  assert.strictEqual(w.getHours(), 7);
  const b = local(parseCommand('set an alarm for 5', ctx, evening).at);
  assert.strictEqual(b.getHours(), 5);
  const c = parseCommand('set an alarm for 9 pm tomorrow called gym', ctx, evening);
  assert.strictEqual(local(c.at).getHours(), 21);
  assert.strictEqual(c.label, 'gym');
});
check('cancel, snooze, confirm', () => {
  assert.strictEqual(parseCommand('cancel the timer', ctx, evening).intent, 'cancel-timer');
  assert.strictEqual(parseCommand('remind me in 15 minutes', ctx, evening).seconds, 900);
  assert.strictEqual(parseCommand('remind me in 15 minutes to call mom', ctx, evening).intent, 'add-task');
  assert.strictEqual(parseCommand('yes', ctx, evening).intent, 'confirm');
});
check('edits: reschedule, category, delete, priority, assign', () => {
  const r = parseCommand('Move call Sam to Friday at 2', ctx, evening);
  assert.strictEqual(r.action, 'reschedule');
  assert.strictEqual(local(r.due).getDay(), 5);
  assert.strictEqual(local(r.due).getHours(), 14);
  assert.strictEqual(parseCommand('move electric bill to work', ctx, evening).category, 'work');
  assert.strictEqual(parseCommand('Delete book flights', ctx, evening).action, 'delete');
  assert.strictEqual(parseCommand('Make electric bill high priority', ctx, evening).priority, 'high');
  assert.strictEqual(parseCommand('assign groceries to Sam', ctx, evening).assignee, 'Sam');
  assert.strictEqual(parseCommand('remove milk from the list', ctx, evening).query, 'milk');
});

check('notes: "take a note" and friends, without stealing tasks', () => {
  const n = parseCommand('Take a note: gate code is 1357, mailroom 2290', ctx, evening);
  assert.strictEqual(n.intent, 'add-note');
  assert.strictEqual(n.note.title, 'Gate code is 1357');
  assert.strictEqual(n.note.body, 'Gate code is 1357, mailroom 2290');
  assert.strictEqual(parseCommand('note that the plumber comes Friday', ctx, evening).intent, 'add-note');
  assert.strictEqual(parseCommand('jot this down oat milk and basil', ctx, evening).intent, 'add-note');
  assert.strictEqual(parseCommand('make a note', ctx, evening).note, null);
  assert.strictEqual(parseCommand('remind me to note the mileage tomorrow', ctx, evening).intent, 'add-task');
  assert.strictEqual(parseCommand('Call Sam Thursday at 3', ctx, evening).intent, 'add-task');
});

check('projects: file tasks into projects, start and query them', () => {
  const pctx = { ...ctx, projects: [{ id: 'p1', name: 'Holiday party' }, { id: 'p2', name: 'Garage cleanout' }] };
  const a = parseCommand('add buy string lights to the holiday party project', pctx, evening);
  assert.strictEqual(a.task.title, 'Buy string lights');
  assert.strictEqual(a.task.projectId, 'p1');
  const b = parseCommand('order decorations friday, high priority, for the holiday party project', pctx, evening);
  assert.strictEqual(b.task.projectId, 'p1');
  assert.strictEqual(b.task.priority, 'high');
  assert.strictEqual(local(b.task.due).getDay(), 5);
  assert.strictEqual(parseCommand('sweep the floor tomorrow in the garage project', pctx, evening).task.projectId, 'p2');
  assert.strictEqual(parseCommand('add pick a color to the kitchen repaint project', pctx, evening).task.projectName, 'Kitchen repaint');
  assert.deepStrictEqual(parseCommand('new project kitchen repaint', pctx, evening), { intent: 'add-project', name: 'Kitchen repaint' });
  assert.strictEqual(parseCommand("how's the holiday party project going", pctx, evening).query, 'holiday party');
  assert.strictEqual(parseCommand('list my projects', pctx, evening).intent, 'list-projects');
  assert.strictEqual(parseCommand('Call Sam Thursday at 3', pctx, evening).task.projectId, null);
});

console.log('Calendar feeds');
check('weekly recurrence with an exception, all-day event', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'DTSTART;TZID=America/Los_Angeles:20260901T093000', 'DTEND;TZID=America/Los_Angeles:20260901T100000',
    'RRULE:FREQ=WEEKLY;BYDAY=TU', 'EXDATE;TZID=America/Los_Angeles:20261020T093000', 'UID:a@x', 'SUMMARY:Standup', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261024', 'DTEND;VALUE=DATE:20261025', 'UID:b@x', 'SUMMARY:Birthday', 'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const evs = expand(ical.sync.parseICS(ics), 'c', new Date(2026, 9, 1), new Date(2026, 10, 1));
  const standups = evs.filter((e) => e.title === 'Standup').map((e) => new Date(e.start).getDate());
  assert.deepStrictEqual(standups.sort((a, b) => a - b), [6, 13, 27]);
  const bday = evs.find((e) => e.title === 'Birthday');
  assert.strictEqual(new Date(bday.start).getDate(), 24);
  assert.strictEqual(new Date(standups.length && evs.find((e) => e.title === 'Standup').start).getHours(), 9);
});

console.log(`\n${pass} checks passed`);
