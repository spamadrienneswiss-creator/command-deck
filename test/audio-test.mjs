// Data Recap audio: the m4a reader finds every AAC frame exactly where ffprobe does,
// and the downsampler turns any rate into 16 kHz.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMp4, Downsampler } from '../renderer/audio.js';

const here = (f) => new URL(`./fixtures/${f}`, import.meta.url);
let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };

ok('mono 48 kHz m4a: codec, rate, channels, frames', () => {
  const info = parseMp4(new Uint8Array(readFileSync(here('tone-3s.m4a'))));
  assert.ok(info, 'found the audio track');
  assert.equal(info.codec, 'mp4a.40.2');
  assert.equal(info.sampleRate, 48000);
  assert.equal(info.channels, 1);
  assert.equal(info.count, 142);
  assert.ok(info.description && info.description.length >= 2, 'has the decoder config');
  // ffprobe: first frames at byte 1375 (154 bytes), 1529 (199), 1728 (90)
  assert.deepEqual([info.offsets[0], info.offsets[1], info.offsets[2]], [1375, 1529, 1728]);
  assert.deepEqual([info.sizes[0], info.sizes[1], info.sizes[2]], [154, 199, 90]);
  assert.ok(Math.abs(info.durationSec - 3) < 0.1, `duration ${info.durationSec}`);
  assert.ok(info.deltas[5] === 1024, 'AAC frames are 1024 samples');
});

ok('stereo 44.1 kHz m4a (frames stored after the header)', () => {
  const info = parseMp4(new Uint8Array(readFileSync(here('tone-2s-stereo.m4a'))));
  assert.equal(info.sampleRate, 44100);
  assert.equal(info.channels, 2);
  assert.equal(info.count, 88);
  assert.deepEqual([info.offsets[0], info.offsets[1], info.offsets[2]], [44, 176, 306]);
  assert.deepEqual([info.sizes[0], info.sizes[1], info.sizes[2]], [132, 130, 142]);
});

ok('not an mp4: no track, no crash', () => {
  assert.equal(parseMp4(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), null);
  assert.equal(parseMp4(new TextEncoder().encode('ID3 this is an mp3, honest')), null);
});

ok('downsampler: 48 kHz → 16 kHz keeps length and level', () => {
  const ds = new Downsampler(48000, 16000, 1);
  const one = new Float32Array(48000).fill(0.5);
  ds.push(one.subarray(0, 10000));
  ds.push(one.subarray(10000)); // arrives in pieces, like decoded frames
  const out = ds.finish();
  assert.equal(out.length, 16000);
  assert.ok(Math.abs(out[100] - 0.5) < 1e-6 && Math.abs(out[15999] - 0.5) < 1e-6);
});

ok('downsampler: 44.1 kHz → 16 kHz, uneven ratio, grows past its first guess', () => {
  const ds = new Downsampler(44100, 16000, 0);
  for (let k = 0; k < 20; k++) ds.push(new Float32Array(44100).fill(k % 2 ? 1 : -1));
  const out = ds.finish();
  assert.ok(Math.abs(out.length - 320000) <= 2, `got ${out.length}`);
});

console.log(`audio: ${passed} passed`);
