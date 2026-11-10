// Record a meeting (v1.28): what the computer plays (Zoom, Teams, a browser call) plus
// your microphone, mixed to one mono Opus track and saved to the recaps folder in
// 10-second pieces while it records. Stop, and it goes through Data Recap like a phone
// recording. Controlled from Comm Tower 1 (and "record meeting" / "stop recording").

const SLICE_MS = 10000;
const LEVEL_MS = 150;

let H = null;
const M = {
  state: 'idle', // idle | starting | recording | paused | stopping
  id: null,
  title: '',
  sources: { sys: true, mic: true },
  startedAt: 0,
  pausedMs: 0,
  pausedAt: 0,
  ctx: null,
  rec: null,
  streams: [],
  meters: {},
  levelTimer: null,
  writes: Promise.resolve(),
  error: ''
};

function uid() { return 'rc_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
const two = (n) => String(n).padStart(2, '0');
export function elapsedMs() {
  if (M.state === 'idle' || !M.startedAt) return 0;
  const now = M.state === 'paused' ? M.pausedAt : Date.now();
  return Math.max(0, now - M.startedAt - M.pausedMs);
}
export function clock(ms = elapsedMs()) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  return h ? `${h}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}
export const recState = () => ({ state: M.state, id: M.id, title: M.title, sources: { ...M.sources }, elapsed: elapsedMs(), error: M.error });
export const isRecording = () => M.state === 'recording' || M.state === 'paused' || M.state === 'starting';

function push(extra = {}) { if (H) H.send({ ...recState(), ...extra }); }

function level(an) {
  if (!an) return 0;
  const buf = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.min(1, Math.sqrt(sum / buf.length) * 4);
}

async function grabSystem() {
  // The main process answers with the screen + "loopback" audio; the picture is dropped at once.
  const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  s.getVideoTracks().forEach((t) => t.stop());
  if (!s.getAudioTracks().length) throw new Error('Windows didn\'t hand over the computer\'s audio.');
  return s;
}
async function grabMic() {
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
}

/** Starts recording. opts: { title, sys, mic } */
export async function start(opts = {}) {
  if (isRecording()) return recState();
  M.sources = { sys: opts.sys !== false, mic: opts.mic !== false };
  if (!M.sources.sys && !M.sources.mic) M.sources.sys = true;
  const now = new Date();
  M.title = String(opts.title || '').trim().slice(0, 80) || `Meeting · ${now.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  M.error = '';
  M.state = 'starting';
  push();
  try {
    const ctx = new AudioContext({ sampleRate: 48000 });
    const dest = ctx.createMediaStreamDestination();
    dest.channelCount = 1;
    M.ctx = ctx;
    M.streams = [];
    M.meters = {};
    const wire = (stream, key) => {
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      src.connect(dest);
      M.meters[key] = an;
      M.streams.push(stream);
    };
    if (M.sources.sys) {
      try { wire(await grabSystem(), 'sys'); } catch (e) { if (!M.sources.mic) throw e; M.sources.sys = false; M.error = 'Couldn\'t get the computer\'s audio, so only your mic is recording.'; }
    }
    if (M.sources.mic) {
      try { wire(await grabMic(), 'mic'); } catch (e) { if (!M.streams.length) throw e; M.sources.mic = false; M.error = 'Couldn\'t get your microphone, so only the computer\'s audio is recording.'; }
    }
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: 32000 });
    M.id = uid();
    M.rec = rec;
    H.createNote(M.id, M.title, M.sources);
    rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      const id = M.id;
      M.writes = M.writes.then(async () => {
        const bytes = new Uint8Array(await e.data.arrayBuffer());
        await H.deck.recap.append(id, 'webm', bytes);
      }).catch((err) => { M.error = 'Saving the recording hit a snag; it\'s still going.'; console.warn(err); });
    };
    rec.start(SLICE_MS);
    M.startedAt = Date.now();
    M.pausedMs = 0;
    M.pausedAt = 0;
    M.state = 'recording';
    M.levelTimer = setInterval(() => push({ levels: { sys: level(M.meters.sys), mic: level(M.meters.mic) } }), LEVEL_MS);
    push();
    return recState();
  } catch (e) {
    cleanup();
    M.state = 'idle';
    M.error = /denied|permission|notallowed/i.test(String(e && (e.name || e.message))) ? 'Windows blocked the recording. Check Settings › Privacy › Microphone.' : `Couldn't start recording: ${(e && e.message) || e}`;
    push();
    throw new Error(M.error);
  }
}

export function pause() {
  if (M.state !== 'recording') return recState();
  M.rec.pause();
  M.pausedAt = Date.now();
  M.state = 'paused';
  push();
  return recState();
}
export function resume() {
  if (M.state !== 'paused') return recState();
  M.rec.resume();
  M.pausedMs += Date.now() - M.pausedAt;
  M.pausedAt = 0;
  M.state = 'recording';
  push();
  return recState();
}

function cleanup() {
  clearInterval(M.levelTimer);
  M.levelTimer = null;
  M.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  M.streams = [];
  if (M.ctx) M.ctx.close().catch(() => {});
  M.ctx = null;
  M.meters = {};
}

/** Stops; keep = true hands it to Data Recap, false throws it away. Returns { id, title, ms }. */
export async function stop({ keep = true } = {}) {
  if (!M.rec || M.state === 'idle' || M.state === 'stopping') return null;
  const rec = M.rec;
  const ms = elapsedMs();
  const out = { id: M.id, title: M.title, ms };
  M.state = 'stopping';
  push();
  await new Promise((res) => { rec.onstop = res; try { rec.stop(); } catch (e) { res(); } });
  await M.writes;
  cleanup();
  M.rec = null;
  M.state = 'idle';
  M.id = null;
  M.startedAt = 0;
  push();
  if (keep) H.recapIt(out.id, out.ms);
  else H.discard(out.id);
  return out;
}

export function initMeeting(hooks) {
  H = hooks;
  // Closing the deck mid-call: what's saved so far is picked up next time (see recap.js).
  window.addEventListener('beforeunload', () => { try { if (M.rec && M.rec.state !== 'inactive') M.rec.requestData(); } catch (e) { /* closing */ } });
}
