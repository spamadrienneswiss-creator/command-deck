// Neural voice playback with optional voice characters: "Robot companion"
// (a boxy built-in speaker with a faint metallic ring), "Ship comms" (an
// intercom tone with a small room), each mixed with the clean voice, or
// "Radio" (a person on a two-way radio: narrow band, compressed, a little
// grit, static under the voice, and a squelch click at each end).

export const NEURAL_VOICES = [
  ['am_fenrir', 'FENRIR · AMERICAN, LOW · DEFAULT'],
  ['bm_george', 'GEORGE · BRITISH, DEEP'],
  ['bm_fable', 'FABLE · BRITISH, WARM'],
  ['bm_lewis', 'LEWIS · BRITISH, CALM'],
  ['bm_daniel', 'DANIEL · BRITISH, CRISP'],
  ['bf_emma', 'EMMA · BRITISH'],
  ['bf_isabella', 'ISABELLA · BRITISH'],
  ['bf_alice', 'ALICE · BRITISH'],
  ['bf_lily', 'LILY · BRITISH'],
  ['am_michael', 'MICHAEL · AMERICAN'],
  ['am_onyx', 'ONYX · AMERICAN, DEEP'],
  ['am_echo', 'ECHO · AMERICAN'],
  ['am_eric', 'ERIC · AMERICAN'],
  ['am_liam', 'LIAM · AMERICAN'],
  ['am_puck', 'PUCK · AMERICAN, BRIGHT'],
  ['am_adam', 'ADAM · AMERICAN'],
  ['af_heart', 'HEART · AMERICAN'],
  ['af_bella', 'BELLA · AMERICAN'],
  ['af_nicole', 'NICOLE · AMERICAN, SOFT'],
  ['af_aoede', 'AOEDE · AMERICAN'],
  ['af_kore', 'KORE · AMERICAN'],
  ['af_sarah', 'SARAH · AMERICAN'],
  ['af_nova', 'NOVA · AMERICAN'],
  ['af_sky', 'SKY · AMERICAN'],
  ['af_alloy', 'ALLOY · AMERICAN'],
  ['af_river', 'RIVER · AMERICAN'],
  ['af_jessica', 'JESSICA · AMERICAN']
];

let worker = null;
let seq = 0;
const pending = new Map();
let loadPromise = null;
let status = { state: 'idle', progress: 0, error: null };
const listeners = new Set();

function setStatus(next) {
  status = { ...status, ...next };
  listeners.forEach((fn) => fn(status));
}

export function onTtsStatus(fn) {
  listeners.add(fn);
  fn(status);
}

export function ttsStatus() {
  return status;
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./tts-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const msg = e.data || {};
    if (msg.type === 'progress') { setStatus({ progress: msg.progress }); return; }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.type === 'error') p.reject(new Error(msg.error));
    else p.resolve(msg);
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || 'Voice synth worker crashed');
    pending.forEach((p) => p.reject(err));
    pending.clear();
    worker = null;
    loadPromise = null;
    setStatus({ state: 'error', error: err.message });
  };
  return worker;
}

function request(type, payload = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, type, ...payload });
  });
}

export function loadTts() {
  if (loadPromise) return loadPromise;
  setStatus({ state: 'loading', progress: 0, error: null });
  loadPromise = request('load')
    .then(() => { setStatus({ state: 'ready', progress: 100 }); })
    .catch((err) => {
      loadPromise = null;
      setStatus({ state: 'error', error: err.message });
      throw err;
    });
  return loadPromise;
}

// ---------------------------------------------------------------- playback
let ctx = null;
let current = null;

function ac() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function impulse(c, seconds, density = 0.023) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  const step = Math.floor(c.sampleRate * density);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Fast decay plus a few early reflections for a hard-walled space.
      const early = (i % step < 30) ? 0.5 : 0;
      d[i] = ((Math.random() * 2 - 1) * 0.45 + early * (Math.random() > 0.5 ? 1 : -1)) * Math.pow(1 - t, 3.6);
    }
  }
  return buf;
}

function saturationCurve(amount) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(amount * x) / Math.tanh(amount);
  }
  return curve;
}

function biquad(c, type, freq, q = 0.7, gain = 0) {
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.gain.value = gain;
  return f;
}

// Builds the output chain. Every effect is mixed in parallel with the clean
// voice (strength 0–1), and a gentle clarity stage sits on the master so
// words stay crisp at any setting.
function buildChain(c, fx = 'robot', strength = 0.6) {
  const s = Math.min(1, Math.max(0, strength));
  const input = c.createGain();
  const master = c.createGain();
  master.gain.value = 1;

  // Clarity stage: trims mud, adds a touch of presence, evens out loudness.
  const mudCut = biquad(c, 'peaking', 320, 1.0, -2.5);
  const presence = biquad(c, 'peaking', 3200, 0.8, 2.5);
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 2.5;
  comp.attack.value = 0.005;
  comp.release.value = 0.18;
  master.connect(mudCut);
  mudCut.connect(presence);
  presence.connect(comp);
  comp.connect(c.destination);

  const dry = c.createGain();
  input.connect(dry);
  dry.connect(master);
  if (fx === 'off' || s === 0) {
    dry.gain.value = 1;
    return { input };
  }
  dry.gain.value = 1 - s * 0.75;
  const wetBus = c.createGain();
  wetBus.gain.value = s;
  wetBus.connect(master);

  if (fx === 'radio') return buildRadio(c, input, master, dry, s);

  if (fx === 'comms') {
    // Ship intercom: band-limited speaker, very light grit, small hard room.
    const hp = biquad(c, 'highpass', 200);
    const lp = biquad(c, 'lowpass', 7000);
    const bite = biquad(c, 'peaking', 2000, 0.9, 3);
    const shaper = c.createWaveShaper();
    shaper.curve = saturationCurve(1.15);
    const room = c.createConvolver();
    room.buffer = impulse(c, 0.45);
    const roomGain = c.createGain();
    roomGain.gain.value = 0.07;
    input.connect(hp);
    hp.connect(bite);
    bite.connect(lp);
    lp.connect(shaper);
    shaper.connect(wetBus);
    shaper.connect(room);
    room.connect(roomGain);
    roomGain.connect(wetBus);
  } else {
    // Companion robot: a boxy built-in speaker with a faint metallic ring,
    // like a voice coming from inside a chassis.
    const hp = biquad(c, 'highpass', 150);
    const box = biquad(c, 'peaking', 1100, 1.3, 3.5);
    const lp = biquad(c, 'lowpass', 8000);
    const body = c.createGain();
    input.connect(hp);
    hp.connect(box);
    box.connect(lp);
    lp.connect(body);
    body.connect(wetBus);
    // Short comb filter = metallic resonance.
    const comb = c.createDelay(0.05);
    comb.delayTime.value = 0.0045;
    const fb = c.createGain();
    fb.gain.value = 0.32;
    const combOut = c.createGain();
    combOut.gain.value = 0.28;
    lp.connect(comb);
    comb.connect(fb);
    fb.connect(comb);
    comb.connect(combOut);
    combOut.connect(wetBus);
    // Tiny chassis reflection.
    const shell = c.createConvolver();
    shell.buffer = impulse(c, 0.18, 0.006);
    const shellGain = c.createGain();
    shellGain.gain.value = 0.05;
    lp.connect(shell);
    shell.connect(shellGain);
    shellGain.connect(wetBus);
  }
  return { input };
}

let noiseBuf = null;
function noise(c) {
  if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
  const len = c.sampleRate * 2;
  noiseBuf = c.createBuffer(1, len, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

// Two-way radio. Strength narrows the band and adds grit and static; the clean
// voice is replaced rather than blended, because a radio never sounds full-range.
function buildRadio(c, input, master, dry, s) {
  dry.gain.value = Math.max(0, 1 - s * 2.5); // fully radio from 40% up
  const wet = c.createGain();
  wet.gain.value = 0.75 - s * 0.15; // matches the loudness of the other characters
  wet.connect(master);
  // Narrow speaker band: steep low cut and high cut (two stages each).
  const lo = 200 + s * 250; // 200–450 Hz
  const hi = 5000 - s * 2200; // 5000–2800 Hz
  const hp1 = biquad(c, 'highpass', lo, 0.8);
  const hp2 = biquad(c, 'highpass', lo, 0.8);
  const lp1 = biquad(c, 'lowpass', hi, 0.8);
  const lp2 = biquad(c, 'lowpass', hi, 0.8);
  // Close-mic presence: the "talking into the handset" push.
  const mid = biquad(c, 'peaking', 1700, 1.1, 3 + s * 3);
  // Radio voices are squashed flat.
  const squash = c.createDynamicsCompressor();
  squash.threshold.value = -28;
  squash.ratio.value = 6;
  squash.knee.value = 8;
  squash.attack.value = 0.003;
  squash.release.value = 0.12;
  const grit = c.createWaveShaper();
  grit.curve = saturationCurve(1 + s * 2.2);
  grit.oversample = '2x';
  input.connect(hp1); hp1.connect(hp2); hp2.connect(mid); mid.connect(squash);
  squash.connect(grit); grit.connect(lp1); lp1.connect(lp2); lp2.connect(wet);

  // Static and squelch live on the same band so they sound like the same radio.
  const band = biquad(c, 'highpass', lo + 150, 0.7);
  const bandTop = biquad(c, 'lowpass', hi, 0.7);
  const bandTop2 = biquad(c, 'lowpass', hi, 0.7);
  band.connect(bandTop); bandTop.connect(bandTop2); bandTop2.connect(master);

  const playNoise = (tok, at, dur, level, attack = 0.004, release = 0.03) => {
    const src = c.createBufferSource();
    src.buffer = noise(c);
    src.loop = true;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + attack);
    if (dur) {
      g.gain.setValueAtTime(level, at + Math.max(attack, dur - release));
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    }
    src.connect(g); g.connect(band);
    src.start(at, Math.random() * 1.5);
    if (dur) src.stop(at + dur + 0.02);
    tok.sources.push(src);
    return { src, g };
  };
  const click = (tok, at, level) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'square';
    o.frequency.value = 1400;
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.012);
    o.connect(g); g.connect(band);
    o.start(at); o.stop(at + 0.02);
    tok.sources.push(o);
  };
  const bedLevel = 0.008 + s * 0.016;
  let bed = null;
  return {
    input,
    lead: 0.09, // seconds between key-up and the first word
    tail: 260, // ms of squelch after the last word
    // Press to talk: a click, a short burst, then a static bed under the voice.
    keyUp(tok, at) {
      click(tok, at, 0.18);
      playNoise(tok, at, 0.07, 0.09 + s * 0.08, 0.002, 0.04);
      bed = playNoise(tok, at + 0.05, 0, bedLevel, 0.03);
    },
    // Release: the bed stops and the receiver squelch tail answers.
    keyDown(tok, at) {
      if (bed) {
        bed.g.gain.setValueAtTime(bedLevel, at);
        bed.g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
        bed.src.stop(at + 0.05);
        bed = null;
      }
      click(tok, at + 0.02, 0.12);
      playNoise(tok, at + 0.03, 0.2, 0.12 + s * 0.1, 0.003, 0.14);
    }
  };
}

// depth 0–100 → pitch drop of up to 3 semitones (as a playback-rate factor).
function depthRate(depth) {
  const st = (Math.min(100, Math.max(0, depth)) / 100) * 3;
  return Math.pow(2, -st / 12);
}

function splitSentences(text) {
  const parts = String(text).match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [String(text)];
  // Merge very short fragments so the voice doesn't stutter between them.
  const out = [];
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (out.length && (out[out.length - 1].length < 24 || p.length < 12)) out[out.length - 1] += ` ${p}`;
    else out.push(p);
  }
  return out;
}

export function stopNeural() {
  if (!current) return;
  const tok = current;
  current = null;
  tok.cancelled = true;
  tok.sources.forEach((src) => { try { src.stop(); } catch (e) { /* already stopped */ } });
  clearTimeout(tok.timer);
  if (tok.resolve) tok.resolve();
}

function schedule(c, chain, tok, samples, rate, t, playbackRate) {
  const buf = c.createBuffer(1, samples.length, rate);
  buf.copyToChannel(samples, 0);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = playbackRate;
  src.connect(chain.input);
  const at = Math.max(t, c.currentTime + 0.02);
  src.start(at);
  tok.sources.push(src);
  return at + buf.duration / playbackRate;
}

function finish(c, tok, t, tail) {
  return new Promise((resolve) => {
    tok.resolve = resolve;
    tok.timer = setTimeout(() => { if (current === tok) current = null; resolve(); }, Math.max(0, (t - c.currentTime) * 1000) + tail);
  });
}

// Plays raw samples through the chain (also used to test the effect).
export function playSamples(chunks, { fx = 'robot', depth = 35, strength = 60 } = {}) {
  stopNeural();
  const c = ac();
  const chain = buildChain(c, fx, strength / 100);
  const tok = { cancelled: false, sources: [] };
  current = tok;
  const pr = depthRate(depth);
  let t = c.currentTime + 0.05;
  if (chain.keyUp) { chain.keyUp(tok, t); t += chain.lead; }
  for (const { samples, rate } of chunks) t = schedule(c, chain, tok, samples, rate, t, pr) + 0.1;
  if (chain.keyDown) chain.keyDown(tok, t - 0.06);
  return finish(c, tok, t, chain.tail || 400);
}

// Speaks text sentence by sentence: while one sentence plays, the next is
// being generated, so long briefings start quickly. Depth lowers the pitch by
// playing slower; Kokoro is asked to speak faster by the same factor, so the
// pace stays where the speed setting puts it.
export async function speakNeural(text, { voice = 'am_fenrir', speed = 1, fx = 'robot', depth = 35, strength = 60 } = {}) {
  stopNeural();
  await loadTts();
  const c = ac();
  const chain = buildChain(c, fx, strength / 100);
  const tok = { cancelled: false, sources: [] };
  current = tok;
  const pr = depthRate(depth);
  const genSpeed = Math.min(2, speed / pr);
  const parts = splitSentences(text);
  let t = c.currentTime + 0.05;
  let next = request('speak', { text: parts[0], voice, speed: genSpeed });
  for (let i = 0; i < parts.length; i++) {
    const res = await next;
    if (tok.cancelled) return;
    if (i + 1 < parts.length) next = request('speak', { text: parts[i + 1], voice, speed: genSpeed });
    if (i === 0 && chain.keyUp) {
      // Key up just before the first word, once it's ready, so there's no dead air.
      t = Math.max(t, c.currentTime + 0.03);
      chain.keyUp(tok, t);
      t += chain.lead;
    }
    t = schedule(c, chain, tok, res.samples, res.rate, t, pr) + 0.14;
  }
  if (tok.cancelled) return;
  if (chain.keyDown) chain.keyDown(tok, t - 0.1);
  await finish(c, tok, t, chain.tail || 350);
}
