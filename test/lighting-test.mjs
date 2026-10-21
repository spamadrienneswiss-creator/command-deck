// Rig lighting: the frame math, the engine (with a stand-in SDK), and, where a C compiler is
// available, the real koffi binding against a stand-in library with iCUE's exact struct layouts.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Lighting, frame, COLORS } = require('../src/lighting.js');
const { loadIcue } = require('../src/icue.js');

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`  ok  ${name}`); }
console.log('Rig lighting');

// ---- a clock and timers we drive by hand
function clock() {
  let now = 1_000_000;
  let id = 0;
  const jobs = new Map();
  return {
    now: () => now,
    setInterval: (fn, ms) => { jobs.set(++id, { fn, ms, next: now + ms, every: true }); return id; },
    setTimeout: (fn, ms) => { jobs.set(++id, { fn, ms, next: now + ms, every: false }); return id; },
    clearInterval: (i) => jobs.delete(i),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...jobs.entries()].filter(([, j]) => j.next <= end).sort((a, b) => a[1].next - b[1].next)[0];
        if (!due) break;
        const [i, j] = due;
        now = j.next;
        if (j.every) j.next += j.ms; else jobs.delete(i);
        j.fn();
      }
      now = end;
    }
  };
}
// ---- a stand-in SDK: two devices, records what was drawn
function fakeSdk() {
  const sdk = {
    connected: true, frames: [], state: null,
    connect(cb) { sdk.state = cb; return 0; },
    disconnect() {},
    devices() {
      if (!sdk.connected) throw Object.assign(new Error('NOT CONNECTED'), { code: 1 });
      return [{ id: 'KB', kind: 'keyboard', model: 'K70', ledCount: 3 }, { id: 'FANS', kind: 'fans', model: 'Core', ledCount: 2 }];
    },
    ledPositions(id) { return id === 'KB' ? [0, 1, 2].map((i) => ({ id: 100 + i, cx: i * 10, cy: 0 })) : [0, 1].map((i) => ({ id: 200 + i, cx: 0, cy: i * 10 })); },
    setColors(device, colors) { sdk.frames.push({ device, colors: colors.map((c) => ({ ...c })) }); return 0; },
    setLayerPriority() { return 0; }
  };
  return sdk;
}
async function rig(cfg = {}) {
  const c = clock();
  const sdk = fakeSdk();
  const states = [];
  const L = new Lighting({ dir: os.tmpdir(), platform: 'win32', loadSdk: () => sdk, fetchSdk: async () => 'x.dll', onState: (s) => states.push(s), ...c });
  await L.configure({ enabled: true, ...cfg });
  return { L, sdk, c, states };
}
const lastBy = (sdk, device) => [...sdk.frames].reverse().find((f) => f.device === device).colors;

await check('red alert pulses between the profile and full red', () => {
  const lo = frame({ name: 'alert' }, 0, 0);
  const hi = frame({ name: 'alert' }, 550, 0);
  assert.deepStrictEqual(lo.slice(0, 3), COLORS.red);
  assert(lo[3] < 0.3 && hi[3] > 0.99);
});
await check('boot sweeps amber in order, then turns green and fades', () => {
  const m = { name: 'boot', readyAt: null };
  assert.strictEqual(frame(m, 100, 0.9), null, 'far LEDs are dark early in the sweep');
  assert.deepStrictEqual(frame(m, 800, 0.1).slice(0, 3), COLORS.amber);
  const ready = { name: 'boot', readyAt: 1000 };
  assert.deepStrictEqual(frame(ready, 1200, 0.5), [...COLORS.green, 1]);
  assert(frame(ready, 2300, 0.5)[3] < 0.3);
});
await check('crew signals: green for GOT IT, coral for a change request', () => {
  assert.deepStrictEqual(frame({ name: 'crew', kind: 'ok' }, 50, 0).slice(0, 3), COLORS.green);
  assert.deepStrictEqual(frame({ name: 'crew', kind: 'change' }, 50, 0).slice(0, 3), COLORS.coral);
});
await check('connects and lists devices, case first then desk', async () => {
  const { L } = await rig();
  const s = L.status();
  assert.strictEqual(s.status, 'connected');
  assert.deepStrictEqual(s.devices.map((d) => d.kind), ['fans', 'keyboard']);
  assert(L.leds.find((l) => l.device === 'FANS').order < L.leds.find((l) => l.device === 'KB').order);
});
await check('an alert draws red, then hands every LED back fully transparent', async () => {
  const { L, sdk, c } = await rig();
  L.moment('alert', true);
  c.advance(560);
  assert(lastBy(sdk, 'KB').every((x) => x.r > 150 && x.g < 40 && x.a > 200));
  L.moment('alert', false);
  c.advance(40);
  assert(lastBy(sdk, 'KB').every((x) => x.a === 0) && lastBy(sdk, 'FANS').every((x) => x.a === 0));
  const n = sdk.frames.length;
  c.advance(2000);
  assert.strictEqual(sdk.frames.length, n, 'nothing is drawn while no moment is running');
});
await check('an unattended alert stops after 2 minutes', async () => {
  const { L, sdk, c } = await rig();
  L.moment('alert', true);
  c.advance(121000);
  assert(lastBy(sdk, 'KB').every((x) => x.a === 0));
});
await check('red alert outranks the computer speaking, which resumes after', async () => {
  const { L, sdk, c } = await rig();
  L.moment('speaking', true);
  c.advance(700);
  assert(lastBy(sdk, 'KB')[0].b > 150, 'blue while speaking');
  L.moment('alert', true);
  c.advance(600);
  assert(lastBy(sdk, 'KB')[0].r > 150 && lastBy(sdk, 'KB')[0].b < 50, 'red takes over');
  L.moment('alert', false);
  c.advance(700);
  assert(lastBy(sdk, 'KB')[0].b > 150, 'back to blue');
  L.moment('speaking', false);
  c.advance(400);
  assert(lastBy(sdk, 'KB').every((x) => x.a === 0), 'fades out, then back to iCUE');
});
await check('crew blips end on their own', async () => {
  const { L, sdk, c } = await rig();
  L.moment('crew', true, { kind: 'change' });
  c.advance(60);
  assert.strictEqual(lastBy(sdk, 'KB')[0].r, Math.round(COLORS.coral[0] * 0.8));
  c.advance(1000);
  assert(lastBy(sdk, 'KB').every((x) => x.a === 0));
});
await check('boot: amber while loading, green once ready, then back to iCUE', async () => {
  const { L, sdk, c } = await rig();
  L.moment('boot', true);
  c.advance(900);
  assert(lastBy(sdk, 'FANS').some((x) => x.a > 0 && x.r > x.g), 'amber reaches the fans first');
  L.moment('boot', false);
  c.advance(300);
  assert(lastBy(sdk, 'KB').every((x) => x.g > x.r && x.a === 255), 'all green');
  c.advance(1500);
  assert(lastBy(sdk, 'KB').every((x) => x.a === 0));
});
await check('switched-off moments and lighting stay dark', async () => {
  const { L, sdk, c } = await rig({ crew: false });
  L.moment('crew', true, { kind: 'ok' });
  c.advance(200);
  assert.strictEqual(sdk.frames.length, 0);
  await L.configure({ enabled: false });
  L.moment('alert', true);
  c.advance(200);
  assert.strictEqual(sdk.frames.length, 0);
  assert.strictEqual(L.status().status, 'off');
});
await check('TRY THEM works even for a moment that is switched off', async () => {
  const { L, sdk, c } = await rig({ crew: false });
  L.test('crew');
  c.advance(60);
  assert(sdk.frames.length > 0);
});
await check('brightness scales the color, not the hand-back', async () => {
  const { L, sdk, c } = await rig({ brightness: 50 });
  L.moment('alert', true);
  c.advance(550);
  assert.strictEqual(lastBy(sdk, 'KB')[0].r, Math.round(COLORS.red[0] * 0.5));
});
await check('waits for iCUE, then connects when it appears', async () => {
  const c = clock();
  const sdk = fakeSdk();
  sdk.connected = false;
  const L = new Lighting({ dir: os.tmpdir(), platform: 'win32', loadSdk: () => sdk, fetchSdk: async () => 'x.dll', ...c });
  await L.configure({ enabled: true });
  assert.strictEqual(L.status().status, 'connecting');
  assert(/iCUE SDK is on/.test(L.status().message));
  sdk.connected = true;
  c.advance(5100);
  assert.strictEqual(L.status().status, 'connected');
});
await check('not on Windows: says so instead of failing', async () => {
  const L = new Lighting({ dir: os.tmpdir(), platform: 'linux', loadSdk: () => { throw new Error('no'); }, fetchSdk: async () => '' });
  await L.configure({ enabled: true });
  assert.strictEqual(L.status().status, 'unsupported');
});

// ---- the real binding, against a stand-in library built from test/fixtures/fake-icue.c
let cc = null;
for (const c of ['cc', 'gcc', 'clang']) { try { execFileSync(c, ['--version'], { stdio: 'ignore' }); cc = c; break; } catch (e) { /* next */ } }
if (cc && process.platform === 'linux') {
  const lib = path.join(os.tmpdir(), `fake-icue-${process.pid}.so`);
  execFileSync(cc, ['-shared', '-fPIC', '-O1', '-pthread', '-o', lib, path.join(root, 'test/fixtures/fake-icue.c')]);
  await check('binding: connects through a callback from another thread', async () => {
    const sdk = loadIcue(lib);
    const states = [];
    assert.strictEqual(sdk.connect((s) => states.push(s)), 0);
    // The stand-in connects from its own thread; give a busy machine up to 5 seconds.
    for (let i = 0; i < 100 && !states.includes('CONNECTED'); i++) await new Promise((r) => setTimeout(r, 50));
    assert.deepStrictEqual(states, ['CONNECTING', 'CONNECTED']);
    const devs = sdk.devices();
    assert.deepStrictEqual(devs.map((d) => [d.id, d.kind, d.model, d.ledCount]), [['{KB-1}', 'keyboard', 'K70 RGB', 3], ['{FANS-1}', 'fans', 'Commander Core', 2]]);
    assert.deepStrictEqual(sdk.ledPositions('{FANS-1}'), [{ id: 200, cx: 1, cy: 0 }, { id: 201, cx: 1, cy: 20 }]);
    assert.strictEqual(sdk.setColors('{KB-1}', [{ id: 100, r: 255, g: 1, b: 2, a: 128 }]), 0);
    const koffi = require('koffi');
    const raw = koffi.load(lib);
    const dev = Buffer.alloc(128); const out = Buffer.alloc(8);
    assert.strictEqual(raw.func('int FakeLast(void *dev, void *out)')(dev, out), 1);
    assert.deepStrictEqual([dev.toString('utf8', 0, dev.indexOf(0)), out.readUInt32LE(0), out[4], out[5], out[6], out[7]], ['{KB-1}', 100, 255, 1, 2, 128]);
    sdk.disconnect();
  });
  fs.rmSync(lib, { force: true });
} else {
  console.log('  --  binding check skipped (needs Linux and a C compiler)');
}

console.log(`\n${passed} lighting checks passed`);
