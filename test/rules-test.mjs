// Firestore security rules check. Runs against the Firestore emulator, so it needs Java and
// the Firebase CLI; the GitHub build runs it before every release:
//   npx firebase-tools@15 emulators:exec --only firestore --project demo-command-deck "node test/rules-test.mjs"
// A release does not ship if any of these fail.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TS = (ms) => firebase.firestore.Timestamp.fromMillis(ms);
const NOW = Date.now();
const HOUR = 3600e3;

const env = await initializeTestEnvironment({
  projectId: 'demo-command-deck',
  firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') }
});

// ---- seed (rules off) -------------------------------------------------------------------------
const TOK = 'GuestLinkTokenAAAAAAAAAAAA';
const CLOSED = 'GuestLinkTokenClosedBBBBBB';
const EXPIRED = 'GuestLinkTokenExpiredCCCCC';
const HELPER = 'GuestLinkTokenHelperDDDDDD';
const ROSTER = 'ScheduleLinkTokenEEEEEEEEE';
const ROSTER_OFF = 'ScheduleLinkTokenClosedFFF';
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await db.doc('decks/deck1').set({ owner: 'desk', pairCode: 'ABC234', pairExpires: TS(NOW + HOUR) });
  await db.doc('decks/deck1/members/desk').set({ kind: 'desktop' });
  await db.doc('decks/deck1/members/phone').set({ kind: 'phone', code: 'ABC234' });
  await db.doc('decks/deck1/tasks/t1').set({ id: 't1', title: 'Secret task' });
  await db.doc('decks/deck2').set({ owner: 'other', pairCode: 'OLD999', pairExpires: TS(NOW - HOUR) });
  await db.doc('pairCodes/ABC234').set({ deckId: 'deck1', owner: 'desk', expires: TS(NOW + HOUR) });
  await db.doc('pairCodes/OLD999').set({ deckId: 'deck2', owner: 'other', expires: TS(NOW - HOUR) });
  const m = (extra) => ({ deckId: 'deck1', projectId: 'p1', guest: 'Jordan', level: 'check', closed: false, expiresAt: null, ...extra });
  await db.doc(`manifests/${TOK}`).set(m());
  await db.doc(`manifests/${CLOSED}`).set(m({ closed: true }));
  await db.doc(`manifests/${EXPIRED}`).set(m({ expiresAt: TS(NOW - HOUR) }));
  await db.doc(`manifests/${HELPER}`).set(m({ level: 'helper' }));
  for (const t of [TOK, CLOSED, EXPIRED, HELPER]) await db.doc(`manifests/${t}/tasks/k1`).set({ id: 'k1', title: 'Paint', done: false, subtasks: [{ id: 'a', text: 'Tape edges', done: false }, { id: 'b', text: 'First coat', done: false }] });
  const r = (extra) => ({ deckId: 'deck1', guest: 'Jordan', closed: false, expiresAt: TS(NOW + 7 * 24 * HOUR), ...extra });
  await db.doc(`rosters/${ROSTER}`).set(r());
  await db.doc(`rosters/${ROSTER_OFF}`).set(r({ closed: true }));
  for (const t of [ROSTER, ROSTER_OFF]) await db.doc(`rosters/${t}/entries/e1`).set({ id: 'e1', type: 'ldc', title: 'Work shift', date: '2026-10-21', start: '09:00', end: '14:00', note: '', reply: null, pending: false });
});

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
let passed = 0;
let failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) {
    failed++;
    console.log(`  FAIL ${name}: ${e.message}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Rules check failed::${name}`);
  }
}

console.log('Firestore rules');
// ---- decks ---------------------------------------------------------------------------------------
await check('a deck member reads their deck and its tasks', async () => {
  await assertSucceeds(as('desk').doc('decks/deck1').get());
  await assertSucceeds(as('phone').doc('decks/deck1/tasks/t1').get());
});
await check('a stranger cannot read a deck or its tasks', async () => {
  await assertFails(as('stranger').doc('decks/deck1').get());
  await assertFails(as('stranger').doc('decks/deck1/tasks/t1').get());
  await assertFails(anon().doc('decks/deck1/tasks/t1').get());
});
await check('a stranger cannot write into a deck', async () => {
  await assertFails(as('stranger').doc('decks/deck1/tasks/t9').set({ title: 'x' }));
});
await check('a phone joins only with the current pairing code', async () => {
  await assertFails(as('p2').doc('decks/deck1/members/p2').set({ kind: 'phone', code: 'WRONG1' }));
  await assertSucceeds(as('p3').doc('decks/deck1/members/p3').set({ kind: 'phone', code: 'ABC234' }));
});
await check('an expired pairing code is refused', async () => {
  await assertFails(as('p4').doc('decks/deck2/members/p4').set({ kind: 'phone', code: 'OLD999' }));
  await assertFails(as('p4').doc('pairCodes/OLD999').get());
});
await check('nobody can add someone else as a member', async () => {
  await assertFails(as('p5').doc('decks/deck1/members/someoneelse').set({ kind: 'phone', code: 'ABC234' }));
});
await check('pairing codes cannot be listed', async () => {
  await assertFails(as('p6').collection('pairCodes').get());
  await assertSucceeds(as('p6').doc('pairCodes/ABC234').get());
});
await check('only the owner changes the deck itself', async () => {
  await assertFails(as('phone').doc('decks/deck1').update({ owner: 'phone' }));
  await assertFails(as('stranger').doc('decks/deck1').delete());
});

// ---- project links ---------------------------------------------------------------------------------
await check('a guest opens a project link by its token', async () => {
  await assertSucceeds(as('g1').doc(`manifests/${TOK}`).get());
  await assertSucceeds(as('g1').doc(`manifests/${TOK}/tasks/k1`).get());
});
await check('project links cannot be listed by guests', async () => {
  await assertFails(as('g1').collection('manifests').get());
});
await check('a check-off guest can tick a task, not rename it', async () => {
  await assertSucceeds(as('g1').doc(`manifests/${TOK}/tasks/k1`).update({ done: true, doneAt: NOW, doneBy: 'Jordan', pending: true, gBy: 'Jordan', gAt: NOW }));
  await assertFails(as('g1').doc(`manifests/${TOK}/tasks/k1`).update({ title: 'Hacked', pending: true, gBy: 'Jordan', gAt: NOW }));
});
await check('any guest can tick a subtask, but not add or remove subtasks', async () => {
  const st = (a, b, extra) => [{ id: 'a', text: 'Tape edges', done: a }, { id: 'b', text: 'First coat', done: b }, ...(extra || [])];
  await assertSucceeds(as('g1').doc(`manifests/${TOK}/tasks/k1`).update({ subtasks: st(true, false), pending: true, gBy: 'Jordan', gAt: NOW }));
  await assertFails(as('g1').doc(`manifests/${TOK}/tasks/k1`).update({ subtasks: st(true, false, [{ id: 'z', text: 'Extra', done: false }]), pending: true, gBy: 'Jordan', gAt: NOW }));
  await assertFails(as('g1').doc(`manifests/${TOK}/tasks/k1`).update({ subtasks: [{ id: 'a', text: 'Tape edges', done: true }], pending: true, gBy: 'Jordan', gAt: NOW }));
});
await check('a closed or expired project link refuses guests', async () => {
  await assertFails(as('g1').doc(`manifests/${CLOSED}/tasks/k1`).get());
  await assertFails(as('g1').doc(`manifests/${EXPIRED}/tasks/k1`).update({ done: true, pending: true, gBy: 'J', gAt: NOW }));
});
await check('a project administrator can add a task, a check-off guest cannot', async () => {
  const t = { id: 'n1', title: 'Buy primer', done: false, addedBy: 'Jordan', pending: true, gBy: 'Jordan', gAt: NOW };
  await assertSucceeds(as('g1').doc(`manifests/${HELPER}/tasks/n1`).set(t));
  await assertFails(as('g1').doc(`manifests/${TOK}/tasks/n1`).set(t));
});
await check('a guest cannot reach the private deck behind a link', async () => {
  await assertFails(as('g1').doc('decks/deck1/tasks/t1').get());
});

// ---- schedule links ---------------------------------------------------------------------------------
const reply = (r) => ({ reply: r, pending: true, gBy: 'Jordan', gAt: NOW });
await check('a guest reads the schedule on a live link', async () => {
  await assertSucceeds(as('g2').doc(`rosters/${ROSTER}/entries/e1`).get());
});
await check('GOT IT is accepted', async () => {
  await assertSucceeds(as('g2').doc(`rosters/${ROSTER}/entries/e1`).update(reply({ state: 'ok', comment: '', at: NOW })));
});
await check('a change request with a note is accepted', async () => {
  await assertSucceeds(as('g2').doc(`rosters/${ROSTER}/entries/e1`).update(reply({ state: 'change', comment: 'Could we do Friday?', at: NOW })));
});
await check('a change request without a note is accepted', async () => {
  await assertSucceeds(as('g2').doc(`rosters/${ROSTER}/entries/e1`).update(reply({ state: 'change', comment: '', at: NOW })));
  await assertSucceeds(as('g2').doc(`rosters/${ROSTER}/entries/e1`).update(reply({ state: 'change', at: NOW })));
});
await check('replies are checked: no made-up states, no huge notes', async () => {
  await assertFails(as('g2').doc(`rosters/${ROSTER}/entries/e1`).update(reply({ state: 'cancel', at: NOW })));
  await assertFails(as('g2').doc(`rosters/${ROSTER}/entries/e1`).update(reply({ state: 'change', comment: 'x'.repeat(501), at: NOW })));
});
await check('a guest cannot change the entry itself', async () => {
  await assertFails(as('g2').doc(`rosters/${ROSTER}/entries/e1`).update({ ...reply({ state: 'ok', at: NOW }), date: '2026-12-25' }));
  await assertFails(as('g2').doc(`rosters/${ROSTER}/entries/e1`).update({ ...reply({ state: 'ok', at: NOW }), start: '06:00' }));
  await assertFails(as('g2').doc(`rosters/${ROSTER}/entries/e9`).set({ id: 'e9', title: 'Fake' }));
});
await check('a stopped schedule link refuses guests', async () => {
  await assertFails(as('g2').doc(`rosters/${ROSTER_OFF}/entries/e1`).get());
  await assertFails(as('g2').doc(`rosters/${ROSTER_OFF}/entries/e1`).update(reply({ state: 'ok', at: NOW })));
});
await check('schedule links cannot be listed by guests', async () => {
  await assertFails(as('g2').collection('rosters').get());
});
await check('the owner manages schedule links', async () => {
  await assertSucceeds(as('desk').doc(`rosters/${ROSTER}/entries/e1`).set({ id: 'e1', title: 'Work shift', date: '2026-10-22', reply: null, pending: false }));
  await assertSucceeds(as('desk').doc(`rosters/${ROSTER}`).update({ closed: true }));
});

await env.cleanup();
console.log(`\n${passed} rules checks passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
