// Command Deck connector: full OAuth + MCP round trip against a fake Firebase.
// Run: node test/connector-test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import worker, { zoned, advanceDue, toFields, fromFields, normalizePairCode } from '../connector/worker.js';

const env = { ENC_KEY: 'test-secret', FIREBASE_PROJECT: 'demo', FIREBASE_API_KEY: 'k', DEFAULT_TZ: 'America/Los_Angeles' };
const ORIGIN = 'https://conn.example';
const DECK = 'deck1';

// ---------------------------------------------------------------- fake Firebase
const docs = new Map(); // path -> fields (Firestore REST shape)
const users = new Map(); // refresh -> uid
const tokens = new Map(); // idToken -> uid
let n = 0;
const setDoc = (path, obj) => docs.set(path, toFields(obj));
setDoc(`decks/${DECK}`, { owner: 'desk', pairCode: 'K7Q4M2', pairExpires: Date.now() + 600e3 });
setDoc(`decks/${DECK}/members/desk`, { kind: 'desktop' });
setDoc('pairCodes/K7Q4M2', { deckId: DECK, owner: 'desk' });
setDoc(`decks/${DECK}/meta/shared`, { scheduleTypes: [{ id: 'appt', name: 'Appointment' }, { id: 'work', name: 'Work' }] });
setDoc(`decks/${DECK}/meta/calendar`, { events: [{ id: 'c1', title: 'Field service', start: new Date(Date.now() + 2 * 3600e3).toISOString(), end: new Date(Date.now() + 3 * 3600e3).toISOString(), allDay: false }] });
setDoc(`decks/${DECK}/tasks/t_old`, { id: 't_old', title: 'Pay electric bill', due: new Date(Date.now() - 3 * 864e5).toISOString(), dueHasTime: false, priority: 'high', done: false, updatedAt: 100, by: 'desk' });
setDoc(`decks/${DECK}/tasks/t_rep`, { id: 't_rep', title: 'Take out bins', due: new Date(Date.now() + 864e5).toISOString(), dueHasTime: false, priority: 'medium', done: false, repeat: { type: 'weekly', interval: 1, days: [] }, updatedAt: 100, by: 'desk' });
setDoc(`decks/${DECK}/tasks/t_gone`, { id: 't_gone', deleted: true, updatedAt: 5 });
setDoc(`decks/${DECK}/notes/n_1`, { id: 'n_1', title: 'Guest Wi-Fi', body: 'net: deck / pass: hello', pinned: true, src: 'typed', updatedAt: 1 });

const reply = (status, body) => new Response(body == null ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const isMember = (uid) => docs.has(`decks/${DECK}/members/${uid}`);

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = init.method || 'GET';
  if (url.host === 'identitytoolkit.googleapis.com') {
    const uid = `anon${++n}`; const rt = `rt-${uid}`; const it = `it-${uid}-${n}`;
    users.set(rt, uid); tokens.set(it, uid);
    return reply(200, { localId: uid, idToken: it, refreshToken: rt, expiresIn: '3600' });
  }
  if (url.host === 'securetoken.googleapis.com') {
    const rt = new URLSearchParams(String(init.body)).get('refresh_token');
    const uid = users.get(rt);
    if (!uid) return reply(400, { error: { message: 'INVALID_REFRESH_TOKEN' } });
    const it = `it-${uid}-${++n}`; tokens.set(it, uid);
    return reply(200, { id_token: it, expires_in: '3600' });
  }
  if (url.host === 'firestore.googleapis.com') {
    const uid = tokens.get(String((init.headers || {}).authorization || '').replace('Bearer ', ''));
    if (!uid) return reply(401, {});
    const path = decodeURIComponent(url.pathname.split('/documents/')[1]);
    const parts = path.split('/');
    if (parts[0] === 'pairCodes') {
      const d = docs.get(path);
      return d ? reply(200, { name: path, fields: d }) : reply(404, {});
    }
    if (parts[0] === 'decks') {
      if (parts.length === 4 && parts[2] === 'members' && method === 'PATCH') {
        const body = JSON.parse(init.body); const deck = fromFields(docs.get(`decks/${parts[1]}`));
        if (parts[3] !== uid || fromFields(body.fields).code !== deck.pairCode || deck.pairExpires < Date.now()) return reply(403, {});
        docs.set(path, body.fields); return reply(200, { name: path, fields: body.fields });
      }
      if (!isMember(uid)) return reply(403, {});
      if (method === 'PATCH') { const body = JSON.parse(init.body); docs.set(path, body.fields); return reply(200, { name: path, fields: body.fields }); }
      if (parts.length % 2 === 1) { // collection list
        const pre = `${path}/`;
        const list = [...docs.entries()].filter(([k]) => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map(([k, f]) => ({ name: k, fields: f }));
        return reply(200, list.length ? { documents: list } : {});
      }
      const d = docs.get(path);
      return d ? reply(200, { name: path, fields: d }) : reply(404, {});
    }
  }
  throw new Error(`unexpected fetch ${url}`);
};

const call = (path, init = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, init), env);
const doc = (kind, id) => { const f = docs.get(`decks/${DECK}/${kind}/${id}`); return f ? fromFields(f) : null; };
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

// ---------------------------------------------------------------- pure helpers
ok(normalizePairCode('k7q-4m2') === 'K7Q4M2', 'code normalizes');
ok(new Date(zoned(2026, 11, 23, 0, 0, 'America/Los_Angeles')).toISOString() === '2026-11-23T08:00:00.000Z', 'LA midnight in winter');
ok(new Date(zoned(2026, 7, 1, 15, 30, 'America/Los_Angeles')).toISOString() === '2026-07-01T22:30:00.000Z', 'LA afternoon in summer');
ok(advanceDue('2026-11-23T08:00:00.000Z', { type: 'weekly', interval: 1 }, 'America/Los_Angeles') === '2026-11-30T08:00:00.000Z', 'weekly repeat');
ok(advanceDue('2026-10-31T07:00:00.000Z', { type: 'daily', interval: 1 }, 'America/Los_Angeles') === '2026-11-01T07:00:00.000Z', 'daily across DST keeps local midnight');

// ---------------------------------------------------------------- unauthenticated
let r = await call('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) });
ok(r.status === 401 && /resource_metadata=/.test(r.headers.get('www-authenticate')), '401 points at the metadata');
r = await call('/.well-known/oauth-protected-resource');
ok((await r.json()).authorization_servers[0] === ORIGIN, 'protected resource metadata');
r = await call('/.well-known/oauth-authorization-server');
const meta = await r.json();
ok(meta.registration_endpoint === `${ORIGIN}/register` && meta.code_challenge_methods_supported.includes('S256'), 'auth server metadata');

// ---------------------------------------------------------------- OAuth
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
r = await call('/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] }) });
ok(r.status === 201, 'register');
const { client_id } = await r.json();
const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const q = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: REDIRECT, state: 'st8', code_challenge: challenge, code_challenge_method: 'S256' });
r = await call(`/authorize?${q}`);
const page = await r.text();
ok(r.status === 200 && page.includes('PAIR CLAUDE') && page.includes('SHOW PAIRING CODE'), 'pairing page');

const form = (extra) => { const f = new URLSearchParams(q); for (const [k, v] of Object.entries(extra)) f.set(k, v); return { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: f.toString() }; };
r = await call('/authorize', form({ code: 'ZZZ-999', tz: 'America/Los_Angeles' }));
ok(r.status === 400 && (await r.text()).includes('Code not recognized'), 'wrong code is refused with a message');
r = await call('/authorize', form({ code: 'k7q-4m2', tz: 'America/Los_Angeles' }));
ok(r.status === 302, 'right code redirects');
const loc = new URL(r.headers.get('location'));
ok(loc.origin + loc.pathname === REDIRECT && loc.searchParams.get('state') === 'st8', 'redirect carries state');
const member = [...docs.keys()].find((k) => k.startsWith(`decks/${DECK}/members/anon`));
ok(member && fromFields(docs.get(member)).kind === 'claude', 'joined the deck as a member named Claude');

const tok = (body) => call('/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
r = await tok({ grant_type: 'authorization_code', code: loc.searchParams.get('code'), code_verifier: 'wrong', client_id, redirect_uri: REDIRECT });
ok(r.status === 400, 'bad PKCE refused');
r = await tok({ grant_type: 'authorization_code', code: loc.searchParams.get('code'), code_verifier: verifier, client_id, redirect_uri: REDIRECT });
const grant = await r.json();
ok(r.status === 200 && grant.access_token && grant.refresh_token, 'tokens issued');
r = await tok({ grant_type: 'refresh_token', refresh_token: grant.refresh_token, client_id });
const again = await r.json();
ok(r.status === 200 && again.access_token, 'refresh works');

// ---------------------------------------------------------------- MCP
let rid = 0;
const rpc = async (method, params) => {
  const res = await call('/mcp', { method: 'POST', headers: { authorization: `Bearer ${again.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
  return (await res.json());
};
const tool = async (name, args = {}) => {
  const out = await rpc('tools/call', { name, arguments: args });
  return { text: out.result.content[0].text, err: out.result.isError };
};
let out = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
ok(out.result.serverInfo.name === 'command-deck' && out.result.instructions.includes('America/Los_Angeles'), 'initialize');
r = await call('/mcp', { method: 'POST', headers: { authorization: `Bearer ${again.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
ok(r.status === 202, 'notification accepted');
out = await rpc('tools/list');
ok(out.result.tools.length === 15 && out.result.tools.find((t) => t.name === 'delete_task').annotations.destructiveHint, 'tools listed, delete marked destructive');

let t = await tool('list_tasks');
ok(t.text.includes('[t_old] Pay electric bill') && t.text.includes('OVERDUE') && !t.text.includes('t_gone'), 'list tasks, overdue shown, tombstones hidden');
ok(t.text.indexOf('t_old') < t.text.indexOf('t_rep'), 'overdue first');

t = await tool('add_task', { title: 'Call landlord about the sink', due_date: '2026-11-23', priority: 'high' });
ok(!t.err && t.text.includes('Mon Nov 23'), 'add task');
const added = [...docs.keys()].filter((k) => k.startsWith(`decks/${DECK}/tasks/t_`)).map((k) => fromFields(docs.get(k))).find((x) => x.title === 'Call landlord about the sink');
ok(added && added.due === '2026-11-23T08:00:00.000Z' && added.dueHasTime === false && added.addedBy === 'Claude', 'stored like a phone task (local midnight)');
ok(added.updatedAt > 1e12 && added.by.startsWith('anon') && Array.isArray(added.subtasks), 'sync stamps + full task shape');

t = await tool('update_task', { id: added.id, due_time: '3:30 pm' });
ok(doc('tasks', added.id).due === '2026-11-23T23:30:00.000Z' && doc('tasks', added.id).dueHasTime, 'set a time on the same day');
const stamp = doc('tasks', added.id).updatedAt;
t = await tool('update_task', { id: added.id, notes: 'ask about the drain too' });
ok(doc('tasks', added.id).updatedAt > stamp && doc('tasks', added.id).notes === 'ask about the drain too', 'edit bumps updatedAt');

t = await tool('complete_task', { id: 't_rep' });
ok(/next date/.test(t.text) && doc('tasks', 't_rep').done === false, 'repeating task moves on');
t = await tool('complete_task', { id: 't_old' });
ok(doc('tasks', 't_old').done === true && doc('tasks', 't_old').doneBy === 'Claude' && doc('tasks', 't_old').updatedAt > 100, 'finish a task');
t = await tool('reopen_task', { id: 't_old' });
ok(doc('tasks', 't_old').done === false, 'reopen');
t = await tool('delete_task', { id: added.id });
ok(doc('tasks', added.id).deleted === true && Object.keys(doc('tasks', added.id)).sort().join() === 'by,deleted,id,updatedAt', 'delete leaves a tombstone');
t = await tool('complete_task', { id: 'nope' });
ok(t.err && /No task/.test(t.text), 'unknown id is a clear error');
t = await tool('add_task', { title: 'x', due_date: 'monday' });
ok(t.err && /2026-11-23/.test(t.text), 'bad date explained');

t = await tool('add_schedule_entry', { title: 'Dentist', date: '2026-11-28', start: '3:30 pm', type: 'appointment' });
ok(!t.err, 'add schedule');
const se = [...docs.keys()].filter((k) => k.startsWith(`decks/${DECK}/schedule/`)).map((k) => fromFields(docs.get(k)))[0];
ok(se.type === 'appt' && se.start === '15:30' && se.end === '' && se.addedBy === null, 'schedule entry shape');
t = await tool('list_schedule', { from: '2026-11-22', days: 7 });
ok(t.text.includes('Dentist') && t.text.includes('Appointment'), 'list schedule');
t = await tool('delete_schedule_entry', { id: se.id });
ok(doc('schedule', se.id).deleted === true, 'remove schedule entry');

t = await tool('list_events', { days: 3 });
ok(t.text.includes('Field service'), 'events from the calendar relay');
t = await tool('deck_overview');
ok(t.text.includes('Overdue (1)') && t.text.includes('Pay electric bill'), 'overview');

t = await tool('add_note', { title: 'Paint colors', body: 'Hallway: Sea Salt' });
const note = [...docs.keys()].filter((k) => k.startsWith(`decks/${DECK}/notes/n_`)).map((k) => fromFields(docs.get(k))).find((x) => x.title === 'Paint colors');
ok(note && note.src === 'typed' && note.editedOn === 'claude', 'add note');
t = await tool('update_note', { id: note.id, append: 'Bedroom: Agreeable Gray' });
ok(doc('notes', note.id).body === 'Hallway: Sea Salt\nBedroom: Agreeable Gray', 'append to note');
t = await tool('list_notes');
ok(t.text.indexOf('Guest Wi-Fi') < t.text.indexOf('Paint colors'), 'pinned first');
t = await tool('read_note', { id: 'n_1' });
ok(t.text.includes('pass: hello'), 'read note');

// ---------------------------------------------------------------- unpaired
docs.delete(member);
t = await tool('list_tasks');
ok(t.err && /unpaired/.test(t.text), 'unpairing on the deck cuts it off');
r = await call('/mcp', { method: 'POST', headers: { authorization: 'Bearer junk', 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
ok(r.status === 401, 'forged token refused');

console.log(`connector-test: ${checks} checks passed`);
