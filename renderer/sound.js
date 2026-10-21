// Synthesized console sounds: a 1970s starship power-up and small UI tones.
// Everything is generated live with the Web Audio API, so no audio files.
let ctx = null;
let master = null;
let level = 'full'; // full | key | silent
let suppressed = false; // true while a voice command is being carried out
let quiet = false; // quiet hours: only 'force' sounds (alarms, timers, mic) play

function ac() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function allowed(kind) {
  if (kind === 'force') return true;
  if (suppressed || quiet) return false;
  if (level === 'silent') return false;
  if (level === 'key') return kind === 'key';
  return true;
}

function tone({ freq = 440, to = null, start = 0, dur = 0.12, type = 'sine', vol = 0.2, attack = 0.005, release = null, filter = null }) {
  const c = ac();
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + (release ?? dur));
  let node = osc;
  if (filter) {
    const f = c.createBiquadFilter();
    f.type = filter.type || 'lowpass';
    f.frequency.value = filter.freq || 1200;
    f.Q.value = filter.q || 0.7;
    osc.connect(f);
    node = f;
  }
  node.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + (release ?? dur) + 0.05);
}

function noise({ start = 0, dur = 0.03, vol = 0.25, freq = 2500, type = 'bandpass' }) {
  const c = ac();
  const t0 = c.currentTime + start;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = 1.2;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t0);
}

// ~3.6 s power-up: CRT hum, relay clicks, rising sweep, data chatter, ready chime.
function boot(short = false) {
  if (!allowed('key')) return;
  const c = ac();
  const t0 = c.currentTime + 0.05;
  const scale = short ? 0.55 : 1;

  // Low transformer hum with a slow filter swell.
  const hum = c.createOscillator();
  const hum2 = c.createOscillator();
  hum.type = 'sawtooth';
  hum2.type = 'square';
  hum.frequency.value = 55;
  hum2.frequency.value = 110.6;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(120, t0);
  lp.frequency.exponentialRampToValueAtTime(900, t0 + 1.6 * scale);
  lp.frequency.exponentialRampToValueAtTime(260, t0 + 3.2 * scale);
  const hg = c.createGain();
  hg.gain.setValueAtTime(0.0001, t0);
  hg.gain.exponentialRampToValueAtTime(0.16, t0 + 0.9 * scale);
  hg.gain.exponentialRampToValueAtTime(0.06, t0 + 2.6 * scale);
  hg.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.7 * scale);
  const hg2 = c.createGain();
  hg2.gain.value = 0.25;
  hum.connect(lp);
  hum2.connect(hg2);
  hg2.connect(lp);
  lp.connect(hg);
  hg.connect(master);
  hum.start(t0);
  hum2.start(t0);
  hum.stop(t0 + 3.8 * scale);
  hum2.stop(t0 + 3.8 * scale);

  // Relay clicks.
  [0.35, 0.62, 0.78, 1.05].forEach((s, i) => noise({ start: s * scale, dur: 0.025, vol: 0.5 - i * 0.06, freq: 1800 + i * 400 }));

  // Rising sweep, a little detuned for that analog wobble.
  tone({ freq: 140, to: 980, start: 0.9 * scale, dur: 1.0 * scale, type: 'triangle', vol: 0.12, attack: 0.2 });
  tone({ freq: 143, to: 990, start: 0.9 * scale, dur: 1.0 * scale, type: 'sine', vol: 0.08, attack: 0.2 });

  // Data chatter.
  const chirps = short ? 6 : 12;
  for (let i = 0; i < chirps; i++) {
    const f = 1100 + Math.round(Math.random() * 6) * 220;
    tone({ freq: f, start: (1.9 + i * 0.075) * scale, dur: 0.04, type: 'square', vol: 0.045, filter: { freq: 3200 } });
  }

  // Ready chime.
  const cs = (short ? 1.5 : 3.0);
  tone({ freq: 880, start: cs, dur: 0.9, type: 'sine', vol: 0.18, attack: 0.01, release: 1.1 });
  tone({ freq: 1320, start: cs + 0.08, dur: 0.9, type: 'sine', vol: 0.1, attack: 0.01, release: 1.0 });
}

const sounds = {
  setLevel(l) { level = l || 'full'; },
  setSuppressed(v) { suppressed = !!v; },
  setQuiet(v) { quiet = !!v; },
  boot,
  click() {
    if (!allowed('ui')) return;
    tone({ freq: 1900, start: 0, dur: 0.03, type: 'square', vol: 0.03, filter: { freq: 4000 } });
  },
  add() {
    if (!allowed('key')) return;
    tone({ freq: 660, start: 0, dur: 0.09, type: 'triangle', vol: 0.14 });
    tone({ freq: 990, start: 0.08, dur: 0.16, type: 'triangle', vol: 0.14 });
  },
  complete() {
    if (!allowed('key')) return;
    tone({ freq: 523, start: 0, dur: 0.1, vol: 0.14 });
    tone({ freq: 659, start: 0.07, dur: 0.1, vol: 0.14 });
    tone({ freq: 784, start: 0.14, dur: 0.1, vol: 0.14 });
    tone({ freq: 1047, start: 0.21, dur: 0.35, vol: 0.12, release: 0.5 });
  },
  reminder() {
    if (!allowed('key')) return;
    for (let i = 0; i < 2; i++) {
      tone({ freq: 880, start: i * 0.42, dur: 0.16, type: 'triangle', vol: 0.2 });
      tone({ freq: 660, start: i * 0.42 + 0.17, dur: 0.18, type: 'triangle', vol: 0.2 });
    }
  },
  micOn() {
    if (!allowed('force')) return;
    tone({ freq: 420, to: 1250, start: 0, dur: 0.12, type: 'sine', vol: 0.14 });
    noise({ start: 0, dur: 0.02, vol: 0.12, freq: 3000 });
  },
  micOff() {
    if (!allowed('force')) return;
    tone({ freq: 1100, to: 380, start: 0, dur: 0.12, type: 'sine', vol: 0.12 });
  },
  // Timer done: a bright three-note figure, played twice. Always audible.
  timer() {
    for (let r = 0; r < 2; r++) {
      const o = r * 0.75;
      tone({ freq: 988, start: o, dur: 0.12, type: 'triangle', vol: 0.22 });
      tone({ freq: 1319, start: o + 0.14, dur: 0.12, type: 'triangle', vol: 0.22 });
      tone({ freq: 1760, start: o + 0.28, dur: 0.3, type: 'triangle', vol: 0.2, release: 0.4 });
    }
  },
  // Alarm: the classic ship klaxon-beep, four double pulses. Always audible.
  alarm() {
    for (let r = 0; r < 4; r++) {
      const o = r * 0.55;
      tone({ freq: 1046, start: o, dur: 0.09, type: 'square', vol: 0.12, filter: { freq: 3000 } });
      tone({ freq: 1046, start: o + 0.15, dur: 0.09, type: 'square', vol: 0.12, filter: { freq: 3000 } });
    }
  },
  error() {
    if (!allowed('key')) return;
    tone({ freq: 150, start: 0, dur: 0.16, type: 'square', vol: 0.08, filter: { freq: 700 } });
    tone({ freq: 120, start: 0.18, dur: 0.22, type: 'square', vol: 0.08, filter: { freq: 600 } });
  }
};

export default sounds;
