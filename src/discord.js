// Discord voice: shows (and toggles) your Discord mute / deafen on the deck.
//
// Talks to the Discord app running on this PC through its local connection (RPC over a
// named pipe, \\?\pipe\discord-ipc-N). Discord only lets an app use that connection if
// you own it or test it, so the operator makes their own (free) Discord application and
// pastes its Client ID and Client Secret into Settings. The first time, Discord pops up
// "Authorize"; after that the deck remembers the access token and refreshes it.
//
// Frames on the pipe: [opcode u32 LE][length u32 LE][JSON]. Opcodes: 0 handshake, 1 frame,
// 2 close, 3 ping, 4 pong.

const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const SCOPES = ['rpc', 'rpc.voice.read', 'rpc.voice.write'];
const REDIRECT = 'http://localhost';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';

function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeUInt32LE(op, 0);
  head.writeUInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

// Splits a stream of bytes into whole frames.
function decoder(onFrame) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8) {
      const op = buf.readUInt32LE(0);
      const len = buf.readUInt32LE(4);
      if (buf.length < 8 + len) break;
      let data = null;
      try { data = JSON.parse(buf.slice(8, 8 + len).toString('utf8')); } catch (e) { /* skip */ }
      buf = buf.slice(8 + len);
      onFrame(op, data);
    }
  };
}

function pipePath(i) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`;
  const dir = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  return `${dir.replace(/\/$/, '')}/discord-ipc-${i}`;
}

/**
 * new DiscordVoice({ load, save, fetch, connect })
 *   load() → { clientId, clientSecret, accessToken, refreshToken, expiresAt }
 *   save(patch) stores changes (tokens).
 * Events: 'state' → { status, mute, deaf, error }
 *   status: off (no codes) | waiting (Discord not running) | authorize (waiting for you to
 *   click Authorize in Discord) | live | error
 */
class DiscordVoice extends EventEmitter {
  constructor({ load, save, fetch: fetchFn = fetch, connect = (p) => net.createConnection(p), retryMs = 15000 } = {}) {
    super();
    this.load = load;
    this.save = save;
    this.fetch = fetchFn;
    this.connect = connect;
    this.retryMs = retryMs;
    this.sock = null;
    this.pending = new Map();
    this.state = { status: 'off', mute: false, deaf: false, error: '' };
    this.timer = null;
    this.stopped = true;
  }

  setState(p) {
    this.state = { ...this.state, ...p };
    this.emit('state', this.state);
  }

  start() {
    this.stopped = false;
    clearTimeout(this.timer);
    const c = this.load() || {};
    if (!c.clientId || !c.clientSecret) { this.close(); this.setState({ status: 'off', error: '' }); return; }
    if (this.sock) return;
    this.open(0);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.close();
    this.setState({ status: 'off' });
  }

  // Codes changed in Settings: start over (and forget the old tokens).
  restart() {
    this.close();
    this.start();
  }

  close() {
    if (this.sock) { try { this.sock.destroy(); } catch (e) { /* gone */ } }
    this.sock = null;
    for (const p of this.pending.values()) p.reject(new Error('Discord connection closed'));
    this.pending.clear();
  }

  retry() {
    this.close();
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.start(), this.retryMs);
  }

  open(i) {
    if (i > 9) { this.setState({ status: 'waiting', error: '' }); this.retry(); return; }
    const c = this.load() || {};
    let sock;
    try { sock = this.connect(pipePath(i)); } catch (e) { this.open(i + 1); return; }
    let ready = false;
    // Not there (no Discord on this pipe number): try the next one.
    sock.once('error', () => { if (this.sock !== sock && !ready) { try { sock.destroy(); } catch (e) { /* */ } this.open(i + 1); } });
    sock.once('connect', () => {
      this.sock = sock;
      sock.on('data', decoder((op, data) => this.onFrame(op, data, () => { ready = true; })));
      sock.on('close', () => { if (this.sock === sock) { this.sock = null; this.setState({ status: 'waiting' }); this.retry(); } });
      sock.on('error', () => { /* 'close' follows */ });
      sock.write(encode(0, { v: 1, client_id: String(c.clientId) }));
    });
  }

  onFrame(op, data, markReady) {
    if (op === 3) { if (this.sock) this.sock.write(encode(4, data)); return; }
    if (op === 2) { this.setState({ status: 'error', error: (data && data.message) || 'Discord closed the connection. Check the Client ID.' }); this.retry(); return; }
    if (!data) return;
    if (data.cmd === 'DISPATCH' && data.evt === 'READY') { markReady(); this.login().catch((e) => { this.setState({ status: 'error', error: e.message }); this.retry(); }); return; }
    if (data.cmd === 'DISPATCH' && data.evt === 'VOICE_SETTINGS_UPDATE') { this.voice(data.data); return; }
    const p = data.nonce && this.pending.get(data.nonce);
    if (p) {
      this.pending.delete(data.nonce);
      if (data.evt === 'ERROR') p.reject(Object.assign(new Error((data.data && data.data.message) || 'Discord error'), { code: data.data && data.data.code }));
      else p.resolve(data.data);
    }
  }

  request(cmd, args = {}, evt) {
    if (!this.sock) return Promise.reject(new Error('Discord is not connected'));
    const nonce = crypto.randomUUID();
    const msg = { cmd, args, nonce };
    if (evt) msg.evt = evt;
    return new Promise((resolve, reject) => {
      this.pending.set(nonce, { resolve, reject });
      this.sock.write(encode(1, msg));
    });
  }

  async token(params) {
    const c = this.load() || {};
    const body = new URLSearchParams({ client_id: String(c.clientId), client_secret: String(c.clientSecret), redirect_uri: REDIRECT, ...params });
    const res = await this.fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    let json = {};
    try { json = await res.json(); } catch (e) { /* */ }
    if (!res.ok || !json.access_token) {
      const why = json.error_description || json.error || `HTTP ${res.status}`;
      throw new Error(/redirect/i.test(why) ? 'Discord wants the redirect http://localhost added under OAuth2 › Redirects in your Discord app.' : /client/i.test(why) ? 'Discord rejected the Client ID or Secret. Check them in Settings.' : `Discord sign-in failed: ${why}`);
    }
    this.save({ accessToken: json.access_token, refreshToken: json.refresh_token || '', expiresAt: Date.now() + (Number(json.expires_in) || 604800) * 1000 });
    return json.access_token;
  }

  async login() {
    const c = this.load() || {};
    let access = c.accessToken;
    if (access && c.expiresAt && c.expiresAt - Date.now() < 3600e3 && c.refreshToken) {
      access = await this.token({ grant_type: 'refresh_token', refresh_token: c.refreshToken }).catch(() => '');
    }
    if (access) {
      try {
        await this.request('AUTHENTICATE', { access_token: access });
      } catch (e) {
        access = '';
        this.save({ accessToken: '', refreshToken: '', expiresAt: 0 });
      }
    }
    if (!access) {
      this.setState({ status: 'authorize', error: '' });
      const r = await this.request('AUTHORIZE', { client_id: String(c.clientId), scopes: SCOPES });
      access = await this.token({ grant_type: 'authorization_code', code: r.code });
      await this.request('AUTHENTICATE', { access_token: access });
    }
    const v = await this.request('GET_VOICE_SETTINGS');
    this.voice(v);
    await this.request('SUBSCRIBE', {}, 'VOICE_SETTINGS_UPDATE');
    this.setState({ status: 'live', error: '' });
  }

  voice(v) {
    if (!v) return;
    const p = {};
    if (typeof v.mute === 'boolean') p.mute = v.mute;
    if (typeof v.deaf === 'boolean') p.deaf = v.deaf;
    if (Object.keys(p).length) this.setState(p);
  }

  /** Sets { mute } and/or { deaf }; returns the new state. */
  async set(patch) {
    if (this.state.status !== 'live') throw new Error(this.state.status === 'off' ? 'Discord isn\'t set up yet. Add your Discord app in Settings › System › DISCORD.' : 'Discord isn\'t running, so there\'s nothing to change.');
    const args = {};
    if (typeof patch.mute === 'boolean') args.mute = patch.mute;
    if (typeof patch.deaf === 'boolean') args.deaf = patch.deaf;
    const v = await this.request('SET_VOICE_SETTINGS', args);
    this.voice(v);
    return this.state;
  }
}

module.exports = { DiscordVoice, encode, decoder, pipePath, SCOPES, REDIRECT };
