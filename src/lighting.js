// Rig lighting: Command Deck's moments on Corsair gear, through iCUE.
//
// The rest of the time iCUE's own profile runs untouched. Command Deck draws on a layer above it
// only while a moment is happening, then makes every LED fully transparent again so the profile
// shows through. Moments, highest priority first:
//   alert     red pulse: a timer or alarm went off, or a task or event is past due.
//             Ends when the alert is dismissed or snoozed, or after 2 minutes.
//   boot      amber sweep across the rig while Command Deck loads, green when it's ready.
//   speaking  blue pulse while the computer talks.
//   crew      a double blip: green for GOT IT or a check-off, coral for a change request.

const path = require('path');
const fs = require('fs');

const SDK_VERSION = '4.0.84';
const SDK_URL = `https://github.com/CorsairOfficial/cue-sdk/releases/download/v${SDK_VERSION}/iCUESDK_${SDK_VERSION}.zip`;
const DLL_NAME = 'iCUESDK.x64_2019.dll';
const FRAME_MS = 33;
const ALERT_CAP_MS = 2 * 60 * 1000;
const LAYER_PRIORITY = 200; // iCUE's own lighting sits at 127

// Deep, saturated tones: on LEDs any white mixed in reads as pastel.
const COLORS = {
  red: [190, 0, 0],
  amber: [230, 85, 0],
  green: [0, 170, 25],
  blue: [40, 120, 255],
  coral: [255, 100, 75]
};
// Sweep order: what's inside the case first, then the desk.
const KIND_ORDER = ['cooler', 'fans', 'ram', 'light strip', 'motherboard', 'graphics card', 'keyboard', 'mouse', 'mousemat', 'headset stand', 'headset', 'controller', 'device'];

const DEFAULTS = { enabled: false, boot: true, alert: true, speaking: true, crew: true, brightness: 80 };

const wave = (t, period) => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period); // 0..1, starts at 0

/**
 * Pure frame function: what one LED should show at time t into a moment.
 * Returns [r, g, b, alpha 0..1] or null for "not drawing" (fully transparent).
 */
function frame(moment, t, order) {
  switch (moment.name) {
    case 'alert':
      return [...COLORS.red, 0.25 + 0.75 * wave(t, 1100)];
    case 'speaking': {
      const fade = moment.endingAt ? Math.max(0, 1 - (t - moment.endingAt) / 300) : 1;
      return [...COLORS.blue, (0.35 + 0.65 * wave(t, 1400)) * fade];
    }
    case 'crew': {
      const c = moment.kind === 'change' ? COLORS.coral : COLORS.green;
      if (t < 180 || (t >= 360 && t < 540)) return [...c, 1];
      if (t < 360) return [...c, 0.1];
      return [...c, Math.max(0, 1 - (t - 540) / 360)];
    }
    case 'boot': {
      if (moment.readyAt == null) {
        // A band of amber travels across the rig, inside the case first, then the desk.
        const head = ((t % 1600) / 1600) * 1.3 - 0.15;
        const d = head - order;
        if (d < 0) return null;
        return [...COLORS.amber, Math.max(0.15, 1 - d * 1.6)];
      }
      const since = t - moment.readyAt;
      return [...COLORS.green, since < 900 ? 1 : Math.max(0, 1 - (since - 900) / 500)];
    }
    default:
      return null;
  }
}

/** How long a moment runs, given what we know; null = until told otherwise. */
function finished(moment, t) {
  if (moment.name === 'crew') return t >= 900;
  if (moment.name === 'alert') return t >= ALERT_CAP_MS;
  if (moment.name === 'speaking') return moment.endingAt != null && t >= moment.endingAt + 300;
  if (moment.name === 'boot') return (moment.readyAt != null && t >= moment.readyAt + 1400) || t >= 30000;
  return true;
}

class Lighting {
  /**
   * deps:
   *   dir                  where the downloaded SDK lives (userData/icue)
   *   loadSdk(dllPath)     → binding from icue.js
   *   fetchSdk(dir)        → Promise<dllPath>: download + unpack Corsair's SDK
   *   onState(state)       status for the settings screen
   *   now(), setInterval, clearInterval, setTimeout   (injectable for tests)
   *   platform             process.platform
   */
  constructor(deps) {
    this.d = { now: () => Date.now(), setInterval, clearInterval, setTimeout, platform: process.platform, ...deps };
    this.cfg = { ...DEFAULTS };
    this.state = { status: 'off', message: '', devices: [] };
    this.sdk = null;
    this.leds = []; // { device, id, order }
    this.moments = new Map();
    this.timer = null;
    this.drawing = false;
    this.connecting = null;
  }

  setState(next) {
    this.state = { ...this.state, ...next };
    if (this.d.onState) this.d.onState(this.status());
  }

  status() {
    return { ...this.state, settings: { ...this.cfg } };
  }

  dllPath() {
    return path.join(this.d.dir, DLL_NAME);
  }

  /** Apply settings from the console (Settings › LIGHTING). */
  async configure(cfg) {
    const was = this.cfg.enabled;
    this.cfg = { ...DEFAULTS, ...(cfg || {}) };
    if (!this.cfg.enabled) {
      if (was) this.shutdown();
      this.setState({ status: 'off', message: '', devices: [] });
      return this.status();
    }
    if (!was || !this.sdk) await this.start();
    return this.status();
  }

  async start() {
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      if (this.d.platform !== 'win32') { this.setState({ status: 'unsupported', message: 'iCUE lighting works on Windows only.' }); return; }
      try {
        let dll = this.dllPath();
        if (!fs.existsSync(dll)) {
          this.setState({ status: 'downloading', message: "Getting Corsair's iCUE SDK (one time, about 350 KB)…" });
          dll = await this.d.fetchSdk(this.d.dir);
        }
        this.sdk = this.d.loadSdk(dll);
      } catch (e) {
        this.setState({ status: 'error', message: `Couldn't load Corsair's iCUE SDK: ${e.message || e}` });
        return;
      }
      this.setState({ status: 'connecting', message: 'Looking for iCUE…' });
      this.sdk.connect((s) => {
        if (s === 'CONNECTED') this.scan();
        else if (s === 'CONNECTION REFUSED') this.setState({ status: 'refused', message: 'iCUE refused the connection. Turn on iCUE › Settings › SDK › iCUE SDK.', devices: [] });
        else if (s === 'CONNECTION LOST' || s === 'CLOSED') this.setState({ status: 'connecting', message: 'iCUE closed. Waiting for it to come back…', devices: [] });
      });
      // The callback above is the fast path; polling covers iCUE starting after Command Deck.
      this.poll = this.d.setInterval(() => { if (this.state.status !== 'connected') this.scan(); }, 5000);
      this.scan();
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  /** Read devices and LED positions. Called when iCUE connects, on RESCAN, and while waiting. */
  scan() {
    if (!this.sdk) return this.status();
    let devices;
    try { devices = this.sdk.devices(); } catch (e) {
      if (e.code === 1) this.setState({ status: 'connecting', message: 'Waiting for iCUE. Make sure it is running and iCUE › Settings › SDK › iCUE SDK is on.', devices: [] });
      else this.setState({ status: 'error', message: `iCUE: ${e.message}` });
      return this.status();
    }
    try { this.sdk.setLayerPriority(LAYER_PRIORITY); } catch (e) { /* older iCUE: default priority still sits above the profile */ }
    const leds = [];
    const found = [];
    devices.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)).forEach((dev) => {
      let pos = [];
      try { pos = this.sdk.ledPositions(dev.id); } catch (e) { return; }
      if (!pos.length) return;
      found.push({ id: dev.id, kind: dev.kind, model: dev.model, leds: pos.length });
      pos.sort((a, b) => a.cy - b.cy || a.cx - b.cx).forEach((p, i) => leds.push({ device: dev.id, id: p.id, local: i / Math.max(1, pos.length - 1), dev: found.length - 1 }));
    });
    // Order across the whole rig: device by device, then position within the device.
    const n = Math.max(1, found.length);
    this.leds = leds.map((l) => ({ device: l.device, id: l.id, order: (l.dev + l.local * 0.9) / n }));
    this.setState({ status: 'connected', message: found.length ? '' : 'iCUE is connected but shared no devices. Check iCUE › Settings › SDK › Devices.', devices: found });
    return this.status();
  }

  /** A moment starts (on = true) or ends (on = false). data: { kind } for crew. */
  moment(name, on = true, data = {}) {
    if (!this.cfg.enabled || !this.cfg[name] && !data.test) return false;
    const now = this.d.now();
    const cur = this.moments.get(name);
    if (name === 'boot') {
      if (on && !cur) this.moments.set(name, { name, start: now, readyAt: null });
      else if (!on && cur && cur.readyAt == null) cur.readyAt = now - cur.start;
    } else if (name === 'speaking') {
      if (on) this.moments.set(name, { name, start: cur && cur.endingAt == null ? cur.start : now, endingAt: null });
      else if (cur && cur.endingAt == null) cur.endingAt = now - cur.start;
    } else if (on) {
      this.moments.set(name, { name, start: now, ...data });
    } else {
      this.moments.delete(name);
    }
    this.run();
    return true;
  }

  /** TRY THEM buttons in settings. */
  test(name) {
    if (!this.cfg.enabled) return false;
    if (name === 'boot') {
      this.moments.delete('boot');
      this.moment('boot', true, { test: true });
      this.d.setTimeout(() => this.moment('boot', false, { test: true }), 2600);
    } else if (name === 'speaking') {
      this.moment('speaking', true, { test: true });
      this.d.setTimeout(() => this.moment('speaking', false, { test: true }), 3000);
    } else if (name === 'alert') {
      this.moment('alert', true, { test: true });
      this.d.setTimeout(() => this.moment('alert', false, { test: true }), 4000);
    } else if (name === 'crew') {
      this.moment('crew', true, { kind: 'ok', test: true });
      this.d.setTimeout(() => this.moment('crew', true, { kind: 'change', test: true }), 1300);
    }
    return true;
  }

  run() {
    if (this.timer || !this.moments.size) return;
    this.timer = this.d.setInterval(() => this.draw(), FRAME_MS);
    this.draw();
  }

  /** Which moment is on top right now. */
  top(now) {
    for (const name of ['alert', 'boot', 'speaking', 'crew']) {
      const m = this.moments.get(name);
      if (!m) continue;
      if (finished(m, now - m.start)) { this.moments.delete(name); continue; }
      return m;
    }
    return null;
  }

  draw() {
    const now = this.d.now();
    const m = this.top(now);
    if (!m) {
      this.d.clearInterval(this.timer);
      this.timer = null;
      if (this.drawing) this.clear();
      return;
    }
    if (!this.sdk || this.state.status !== 'connected' || !this.leds.length) return;
    const t = now - m.start;
    const k = Math.max(0, Math.min(100, this.cfg.brightness ?? 80)) / 100;
    const byDevice = new Map();
    for (const led of this.leds) {
      const f = frame(m, t, led.order);
      const c = f ? { id: led.id, r: Math.round(f[0] * k), g: Math.round(f[1] * k), b: Math.round(f[2] * k), a: Math.round(255 * Math.max(0, Math.min(1, f[3]))) } : { id: led.id, r: 0, g: 0, b: 0, a: 0 };
      if (!byDevice.has(led.device)) byDevice.set(led.device, []);
      byDevice.get(led.device).push(c);
    }
    this.push(byDevice);
    this.drawing = true;
  }

  /** Hand the lights back: every LED fully transparent, so the iCUE profile shows. */
  clear() {
    this.drawing = false;
    if (!this.sdk || this.state.status !== 'connected') return;
    const byDevice = new Map();
    for (const led of this.leds) {
      if (!byDevice.has(led.device)) byDevice.set(led.device, []);
      byDevice.get(led.device).push({ id: led.id, r: 0, g: 0, b: 0, a: 0 });
    }
    this.push(byDevice);
  }

  push(byDevice) {
    for (const [device, colors] of byDevice) {
      try {
        const err = this.sdk.setColors(device, colors);
        if (err === 1) { this.setState({ status: 'connecting', message: 'iCUE closed. Waiting for it to come back…' }); return; }
      } catch (e) { /* a device unplugged mid-frame; the next scan drops it */ }
    }
  }

  shutdown() {
    this.moments.clear();
    if (this.timer) { this.d.clearInterval(this.timer); this.timer = null; }
    if (this.drawing) this.clear();
    if (this.poll) { this.d.clearInterval(this.poll); this.poll = null; }
    if (this.sdk) { try { this.sdk.disconnect(); } catch (e) { /* ok */ } this.sdk = null; }
    this.leds = [];
  }
}

/** Downloads Corsair's SDK zip from their GitHub release and unpacks the x64 DLL (Windows). */
async function fetchSdkWindows(dir, { fetch, execFile }) {
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, 'icue-sdk.zip');
  const res = await fetch(SDK_URL);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const out = path.join(dir, 'unpacked');
  await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${out.replace(/'/g, "''")}' -Force`],
  { windowsHide: true }, (err) => (err ? reject(err) : resolve())));
  const src = path.join(out, 'iCUESDK', 'redist', 'x64', DLL_NAME);
  if (!fs.existsSync(src)) throw new Error('the download did not contain the SDK');
  const dll = path.join(dir, DLL_NAME);
  fs.copyFileSync(src, dll);
  try { fs.rmSync(out, { recursive: true, force: true }); fs.rmSync(zip, { force: true }); } catch (e) { /* tidy-up only */ }
  return dll;
}

module.exports = { Lighting, fetchSdkWindows, frame, finished, DEFAULTS, COLORS, SDK_URL };
