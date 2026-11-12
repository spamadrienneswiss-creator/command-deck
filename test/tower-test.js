// The terminal's Gemini replies (Comm Tower 1 and the deck terminal), against a fake Gemini. Run with: npm test
const assert = require('assert');
const { towerReply, towerLookup, towerPrompt, towerTurn } = require('../src/gemini');

let pass = 0;
const check = async (name, fn) => {
  try { await fn(); pass++; console.log('  ok ', name); } catch (e) { console.error('  FAIL', name, '\n      ', e.message); process.exitCode = 1; }
};
const fakeGemini = (reply, seen = {}) => async (url, init) => {
  seen.url = url;
  seen.body = JSON.parse(init.body);
  const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
};

(async () => {
  console.log('Terminal replies');
  await check('a filed task: the turn carries the deck\'s own confirmation; the instructions carry the context', async () => {
    const seen = {};
    const r = await towerReply({ key: 'k', name: 'COMM TOWER 1', operator: 'Nick', heard: 'remember to renew the registration on the 20th', done: { reply: 'Task logged: Renew the registration, due Friday, November 20th.', kind: 'ok' }, context: 'Open tasks:\n- Oil change (due Thursday)' }, fakeGemini({ reply: 'You got it, Nick. Registration is on for Friday the 20th.' }, seen));
    assert.strictEqual(r.reply, 'You got it, Nick. Registration is on for Friday the 20th.');
    assert.strictEqual(r.command, '');
    assert.deepStrictEqual(r.act, []);
    const turn = seen.body.contents[seen.body.contents.length - 1].parts[0].text;
    assert.ok(/ALREADY done/.test(turn) && /Renew the registration/.test(turn));
    assert.ok(/Oil change/.test(seen.body.systemInstruction.parts[0].text));
    assert.strictEqual(seen.body.generationConfig.responseMimeType, 'application/json');
  });
  await check('the conversation so far goes along, oldest first, before the new message', async () => {
    const seen = {};
    await towerReply({ key: 'k', heard: 'and Friday?', history: [{ role: 'user', text: 'am I free Thursday?' }, { role: 'model', text: 'Thursday is clear.' }] }, fakeGemini({ reply: 'Friday has the dentist at 10.' }, seen));
    const c = seen.body.contents;
    assert.strictEqual(c.length, 3);
    assert.deepStrictEqual(c.map((x) => x.role), ['user', 'model', 'user']);
    assert.ok(/Thursday is clear/.test(c[1].parts[0].text) && /and Friday\?/.test(c[2].parts[0].text));
  });
  await check('what it remembers rides in the instructions', async () => {
    const p = towerPrompt({ operator: 'Nick', memory: ['Nick\'s wife is Adrienne', 'Prefers mornings for appointments'] });
    assert.ok(/WHAT YOU REMEMBER ABOUT NICK/.test(p) && /Adrienne/.test(p) && /mornings/.test(p));
    assert.ok(/WHAT YOU REMEMBER: nothing yet/.test(towerPrompt({ memory: [] })));
  });
  await check('long answers keep their line breaks; actions, memories and lookups come back cleaned', async () => {
    const r = await towerReply({ key: 'k', heard: 'plan my Saturday' }, fakeGemini({
      reply: 'Here is a plan:\n\n\n- Gym at 9\n- Groceries after',
      act: ['Add task buy groceries on Saturday', '', 'Set a timer for 20 minutes', 'x', 'y'],
      remember: ['Nick goes to the gym on Saturday mornings'],
      forget: [],
      lookup: ''
    }));
    assert.strictEqual(r.reply, 'Here is a plan:\n\n- Gym at 9\n- Groceries after');
    assert.deepStrictEqual(r.act, ['Add task buy groceries on Saturday', 'Set a timer for 20 minutes', 'x']);
    assert.deepStrictEqual(r.remember, ['Nick goes to the gym on Saturday mornings']);
  });
  await check('a question can still come back with an offer (a deck command)', async () => {
    const r = await towerReply({ key: 'k', operator: 'Nick', heard: 'can I fit the dentist in Tuesday?' }, fakeGemini({ reply: 'Tuesday morning is open. Want me to hold 10 AM? Type yes.', command: 'Add dentist appointment on Tuesday November 10 at 10 AM' }));
    assert.strictEqual(r.command, 'Add dentist appointment on Tuesday November 10 at 10 AM');
  });
  await check('a web lookup asks Google Search and answers in plain text', async () => {
    const seen = {};
    const r = await towerLookup({ key: 'k', heard: 'did the Dodgers win?', query: 'Dodgers score last night' }, fakeGemini('Yes, 5 to 3 over the Giants.', seen));
    assert.strictEqual(r.reply, 'Yes, 5 to 3 over the Giants.');
    assert.ok(Array.isArray(seen.body.tools) && seen.body.tools[0].google_search);
    await assert.rejects(() => towerLookup({ key: 'k', query: '' }, fakeGemini('x')));
  });
  await check('no key, or Gemini says nothing: it throws, so the deck uses its own reply', async () => {
    await assert.rejects(() => towerReply({ key: '', heard: 'x' }, fakeGemini({ reply: 'hi' })));
    await assert.rejects(() => towerReply({ key: 'k', heard: 'x' }, fakeGemini({ reply: '' })));
  });
  await check('a slow Gemini is cut off', async () => {
    const slow = (url, init) => new Promise((_res, rej) => { init.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
    await assert.rejects(() => towerReply({ key: 'k', heard: 'x', timeoutMs: 50 }, slow));
  });
  await check('humor and name shape the voice; the turn carries the time', async () => {
    assert.ok(/Strictly businesslike/.test(towerPrompt({ humor: 0 })));
    assert.ok(/You are Lookout/.test(towerPrompt({ name: 'Lookout' })));
    assert.ok(/^\[Thu Nov 12, 9:05 AM\] hello/.test(towerTurn({ heard: 'hello', when: 'Thu Nov 12, 9:05 AM' })));
  });
  console.log(`\n${pass} checks passed`);
})();
