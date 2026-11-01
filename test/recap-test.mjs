// Data Recap: transcript tidying, block cuts, audio retention, and the Gemini call
// (against a stand-in for Google's server, including a renamed model).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mergeSegments, quietCut, audioDeleteAt, isRecap, friendlyError } from '../renderer/recap.js';

const require = createRequire(import.meta.url);
const gemini = require('../src/gemini.js');

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log(`  ok  ${name}`); };

await ok('Whisper phrases become sentence-sized lines with their first timestamp', () => {
  const lines = mergeSegments([
    { t: 0, text: 'Okay, so the main thing' }, { t: 2.1, text: 'today is the timeline.' },
    { t: 4, text: 'Where are we on demo?' }, { t: 6, text: 'We can start demo the week of the seventeenth.' },
    { t: 9, text: '' }, { t: 70, text: 'Much later.' }
  ]);
  assert.equal(lines[0].t, 0);
  assert.equal(lines[0].text, 'Okay, so the main thing today is the timeline.');
  assert.equal(lines[1].t, 4);
  assert.equal(lines[1].text, 'Where are we on demo? We can start demo the week of the seventeenth.', 'a short question joins the next sentence');
  assert.equal(lines[2].t, 70, 'a long gap starts a new line');
});

await ok('very long run-ons still break into lines', () => {
  const words = Array.from({ length: 12 }, (_, i) => ({ t: i * 2, text: 'and then we talked some more' }));
  const lines = mergeSegments(words);
  assert.ok(lines.length >= 2, `got ${lines.length}`);
  assert.ok(lines.every((l) => l.text.split(' ').length <= 36));
});

await ok('blocks are cut in the quietest moment near the five-minute mark', () => {
  const rate = 16000;
  const s = new Float32Array(rate * 20).fill(0.5);
  s.fill(0, rate * 11, Math.round(rate * 11.4)); // a pause at 11 s
  const cut = quietCut(s, rate * 10, rate);
  assert.ok(cut > rate * 11 && cut <= rate * 11.4 + 1, `cut at ${cut / rate}s`);
});

await ok('audio retention: keep, 30 days after the recap, delete now, already deleted', () => {
  const ready = Date.UTC(2026, 9, 31);
  assert.equal(audioDeleteAt({ readyAt: ready, audio: { keep: 'keep' } }), null);
  assert.equal(audioDeleteAt({ readyAt: ready, audio: { keep: 'd30' } }), ready + 30 * 864e5);
  assert.ok(Math.abs(audioDeleteAt({ readyAt: ready, audio: { keep: 'now' } }) - Date.now()) < 1000);
  assert.equal(audioDeleteAt({ readyAt: ready, audio: { keep: 'd30', deleted: true } }), null);
  assert.equal(audioDeleteAt({ audio: { keep: 'd30' } }), null, 'nothing is deleted before the recap is done');
  assert.ok(isRecap({ src: 'recap', recap: {} }) && !isRecap({ src: 'typed' }));
});

// ---- Gemini, with a stand-in server
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    for (const [re, handler] of routes) {
      if (re.test(url)) {
        const { status = 200, json } = handler(url, init);
        return { status, ok: status >= 200 && status < 300, json: async () => json };
      }
    }
    return { status: 404, ok: false, json: async () => ({ error: { message: 'not found' } }) };
  };
  fn.calls = calls;
  return fn;
}
const transcript = [{ t: 0, text: 'We can start demo the week of the seventeenth.' }, { t: 62, text: 'I need your cabinet color by Friday.' }];
const reply = (obj) => ({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } });

await ok('summarize: sends the transcript with timestamps and reads the JSON back', async () => {
  const f = fakeFetch([[/gemini-flash-latest:generateContent/, (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(init.headers['x-goog-api-key'], 'K');
    assert.ok(body.contents[0].parts[0].text.includes('[01:02] I need your cabinet color by Friday.'));
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    return reply({ title: 'Kitchen remodel call', summary: 'Demo starts Nov 17.', points: ['Demo week of Nov 17'], actions: ['Send the cabinet color by Friday'] });
  }]]);
  const r = await gemini.summarize({ key: 'K', transcript, title: 'New Recording 14' }, f);
  assert.equal(r.model, 'gemini-flash-latest');
  assert.equal(r.title, 'Kitchen remodel call');
  assert.deepEqual(r.actions, ['Send the cabinet color by Friday']);
});

await ok('summarize: a model Google renamed falls back to one the key can see', async () => {
  const f = fakeFetch([
    [/gemini-old-flash:generateContent/, () => ({ status: 404, json: { error: { message: 'models/gemini-old-flash is not found' } } })],
    [/gemini-flash-latest:generateContent/, () => ({ status: 404, json: { error: { message: 'not found' } } })],
    [/gemini-flash-lite-latest:generateContent/, () => ({ status: 404, json: { error: { message: 'not found' } } })],
    [/\/models\?/, () => ({ json: { models: [
      { name: 'models/gemini-9.0-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-9.0-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-9.5-flash-preview', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-9.0-flash-image', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding', supportedGenerationMethods: ['embedContent'] }
    ] } })],
    [/gemini-9\.0-flash:generateContent/, () => reply({ summary: 'S', points: [], actions: [] })]
  ]);
  const r = await gemini.summarize({ key: 'K', model: 'gemini-old-flash', transcript }, f);
  assert.equal(r.model, 'gemini-9.0-flash', 'stable full Flash wins over lite, preview and image models');
  assert.equal(r.summary, 'S');
});

await ok('summarize: a bad key and a used-up free limit say so plainly', async () => {
  const bad = fakeFetch([[/generateContent/, () => ({ status: 400, json: { error: { message: 'API key not valid. Please pass a valid API key.' } } })]]);
  await assert.rejects(gemini.summarize({ key: 'nope', transcript }, bad), /rejected the key/);
  const busy = fakeFetch([[/generateContent/, () => ({ status: 429, json: { error: { message: 'quota' } } })]]);
  await assert.rejects(gemini.summarize({ key: 'K', transcript }, busy), /free limit/);
  await assert.rejects(gemini.summarize({ key: '', transcript }, busy), /Add a Gemini key/);
  await assert.rejects(gemini.summarize({ key: 'K', transcript: [] }, busy), /no speech/);
});

await ok('summarize: a blocked or empty reply is an error, not a blank recap', async () => {
  const f = fakeFetch([[/generateContent/, () => ({ json: { candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] } })]]);
  await assert.rejects(gemini.summarize({ key: 'K', transcript }, f), /safety/);
});

await ok('parseRecap trims, caps and tolerates code fences', () => {
  const r = gemini.parseRecap('```json\n{"summary":"  hi  ","points":["a","",null,"b"],"actions":"oops"}\n```');
  assert.equal(r.summary, 'hi');
  assert.deepEqual(r.points, ['a', 'b']);
  assert.deepEqual(r.actions, []);
});

await ok('testKey picks the best model, or explains the failure', async () => {
  const f = fakeFetch([[/\/models\?/, () => ({ json: { models: [{ name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] }] } })]]);
  assert.deepEqual(await gemini.testKey('K', f), { ok: true, model: 'gemini-3.6-flash' });
  const no = fakeFetch([[/\/models\?/, () => ({ status: 403, json: { error: { message: 'denied' } } })]]);
  const r = await gemini.testKey('K', no);
  assert.equal(r.ok, false);
  assert.match(r.error, /rejected the key/);
});

await ok('errors read in plain words: no internet for the speech model, out of memory', () => {
  assert.match(friendlyError(new TypeError('Failed to fetch')), /transcription engine.*needs the internet/);
  assert.match(friendlyError(new Error('Could not locate file: "https://huggingface.co/x/onnx/encoder.onnx"')), /TRY AGAIN once this PC is online/);
  assert.match(friendlyError(new RangeError('Array buffer allocation failed')), /ran out of memory/);
  assert.equal(friendlyError(new Error('The recording isn\'t on this computer anymore.')), 'The recording isn\'t on this computer anymore.');
});

console.log(`recap: ${passed} passed`);
