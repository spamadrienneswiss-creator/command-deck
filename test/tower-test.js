// Comm Tower 1's Gemini replies, against a fake Gemini. Run with: npm test
const assert = require('assert');
const { towerReply, towerPrompt } = require('../src/gemini');

let pass = 0;
const check = async (name, fn) => {
  try { await fn(); pass++; console.log('  ok ', name); } catch (e) { console.error('  FAIL', name, '\n      ', e.message); process.exitCode = 1; }
};
const fakeGemini = (reply, seen = {}) => async (url, init) => {
  seen.url = url;
  seen.body = JSON.parse(init.body);
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }) };
};

(async () => {
  console.log('Comm Tower 1 replies');
  await check('a filed task: the prompt carries the deck\'s own confirmation and the context', async () => {
    const seen = {};
    const r = await towerReply({ key: 'k', name: 'COMM TOWER 1', operator: 'Nick', heard: 'remember to renew the registration on the 20th', done: { reply: 'Task logged: Renew the registration, due Friday, November 20th.', kind: 'ok' }, context: 'Open tasks:\n- Oil change (due Thursday)' }, fakeGemini({ reply: 'You got it, Nick. Registration is on for Friday the 20th.', command: '' }, seen));
    assert.strictEqual(r.reply, 'You got it, Nick. Registration is on for Friday the 20th.');
    assert.strictEqual(r.command, '');
    const prompt = seen.body.contents[0].parts[0].text;
    assert.ok(/ALREADY done/.test(prompt) && /Renew the registration/.test(prompt) && /Oil change/.test(prompt));
    assert.strictEqual(seen.body.generationConfig.responseMimeType, 'application/json');
  });
  await check('a question can come back with an offer (a deck command)', async () => {
    const r = await towerReply({ key: 'k', operator: 'Nick', heard: 'can I fit the dentist in Tuesday?', done: null, context: '' }, fakeGemini({ reply: 'Tuesday morning is open. Want me to hold 10 AM? Click and say yes.', command: 'Add dentist appointment on Tuesday November 10 at 10 AM' }));
    assert.ok(/hold 10 AM/.test(r.reply));
    assert.strictEqual(r.command, 'Add dentist appointment on Tuesday November 10 at 10 AM');
  });
  await check('no key, or Gemini says nothing: it throws, so the deck uses its own reply', async () => {
    await assert.rejects(() => towerReply({ key: '', heard: 'x' }, fakeGemini({ reply: 'hi' })));
    await assert.rejects(() => towerReply({ key: 'k', heard: 'x' }, fakeGemini({ reply: '' })));
  });
  await check('a slow Gemini is cut off', async () => {
    const slow = (url, init) => new Promise((_res, rej) => { init.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
    await assert.rejects(() => towerReply({ key: 'k', heard: 'x', timeoutMs: 50 }, slow));
  });
  await check('humor and name shape the voice', async () => {
    assert.ok(/Strictly businesslike/.test(towerPrompt({ humor: 0, heard: 'x' })));
    assert.ok(/You are Lookout/.test(towerPrompt({ name: 'Lookout', heard: 'x' })));
  });
  console.log(`\n${pass} checks passed`);
})();
