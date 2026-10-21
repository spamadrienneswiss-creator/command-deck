// Voice input: records from the default microphone and transcribes on this
// computer with Whisper (via Transformers.js). Audio never leaves the machine.
// The speech model (~80 MB) downloads once on first use, then works offline.

let worker = null;
let seq = 0;
const pending = new Map();
let loadPromise = null;
let status = { state: 'idle', progress: 0, error: null };
const listeners = new Set();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./asr-worker.js', import.meta.url), { type: 'module' });
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
    const err = new Error(e.message || 'Voice worker crashed');
    pending.forEach((p) => p.reject(err));
    pending.clear();
    worker = null;
    loadPromise = null;
    setStatus({ state: 'error', error: err.message });
  };
  return worker;
}

function request(type, payload = {}, transfer = []) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, type, ...payload }, transfer);
  });
}

function setStatus(next) {
  status = { ...status, ...next };
  listeners.forEach((fn) => fn(status));
}

export function onVoiceStatus(fn) {
  listeners.add(fn);
  fn(status);
}

export function voiceStatus() {
  return status;
}

export function loadModel() {
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

const JUNK = /^(?:\[.*\]|\(.*\)|you|thank you\.?|thanks for watching!?|bye\.?|\.+)$/i;

export async function transcribe(audio) {
  await loadModel();
  const out = await request('transcribe', { audio }, [audio.buffer]);
  const text = String(out.text || '').replace(/\s+/g, ' ').trim();
  return JUNK.test(text) ? '' : text;
}

// Records until the speaker pauses (or a stop request / time limit).
// Returns { done: Promise<{audio, heard}>, stop() }.
export async function record({ onLevel, maxMs = 30000, silenceMs = 2200, noSpeechMs = 8000 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  });
  const ctx = new AudioContext({ sampleRate: 16000 });
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(2048, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  src.connect(proc);
  proc.connect(mute);
  mute.connect(ctx.destination);

  const chunks = [];
  const startedAt = performance.now();
  let lastLoud = startedAt;
  let heard = false;
  let finished = false;
  let noiseFloor = 0.006;
  let smooth = 0;
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });

  const finish = () => {
    if (finished) return;
    finished = true;
    proc.onaudioprocess = null;
    try { src.disconnect(); proc.disconnect(); mute.disconnect(); } catch (e) { /* already closed */ }
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
    let len = 0;
    chunks.forEach((c) => { len += c.length; });
    const audio = new Float32Array(len);
    let off = 0;
    chunks.forEach((c) => { audio.set(c, off); off += c.length; });
    resolveDone({ audio, heard });
  };

  proc.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(data));
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    const now = performance.now();
    smooth = smooth * 0.6 + rms * 0.4;
    // Learn the room's background hum from the first moments, but ignore loud
    // frames so starting to talk right away can't fool it into a high bar.
    if (now - startedAt < 500 && rms < 0.03) noiseFloor = Math.min(0.02, Math.max(noiseFloor, rms * 1.4));
    const startBar = Math.max(0.015, noiseFloor * 2);
    // Once speech has started, softer sounds (trailing words, breaths between
    // phrases) still count as talking, so pauses mid-sentence don't end it.
    const keepBar = startBar * 0.5;
    if (!heard && smooth > startBar) { heard = true; lastLoud = now; }
    else if (heard && smooth > keepBar) lastLoud = now;
    if (onLevel) onLevel(Math.min(1, rms / 0.12));
    if (heard && now - lastLoud > silenceMs) finish();
    else if (!heard && now - startedAt > noSpeechMs) finish();
    else if (now - startedAt > maxMs) finish();
  };

  return { done, stop: finish };
}
