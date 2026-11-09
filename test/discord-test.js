// Discord voice (src/discord.js) against a fake Discord on a local socket. Run with: npm test
const assert = require('assert');
const net = require('net');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { DiscordVoice, encode, decoder } = require('../src/discord');

let pass = 0;
const check = async (name, fn) => {
  try { await fn(); pass++; console.log('  ok ', name); } catch (e) { console.error('  FAIL', name, '\n      ', e.stack || e.message); process.exitCode = 1; }
};
const until = async (fn, ms = 2000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); } };

// A tiny fake Discord: handshake → READY, then answers the commands the deck sends.
function fakeDiscord(sockPath, { authOk = true } = {}) {
  const log = [];
  let voice = { mute: false, deaf: false };
  let client = null;
  const server = net.createServer((sock) => {
    client = sock;
    sock.on('data', decoder((op, msg) => {
      if (op === 0) { log.push(['HANDSHAKE', msg.client_id]); sock.write(encode(1, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 } })); return; }
      log.push([msg.cmd, msg.args]);
      const reply = (data, evt) => sock.write(encode(1, { cmd: msg.cmd, nonce: msg.nonce, data, evt: evt || null }));
      if (msg.cmd === 'AUTHORIZE') return reply({ code: 'the-code' });
      if (msg.cmd === 'AUTHENTICATE') return msg.args.access_token === 'good-token' || authOk ? reply({ user: { id: '1' } }) : reply({ code: 4009, message: 'Invalid token' }, 'ERROR');
      if (msg.cmd === 'GET_VOICE_SETTINGS') return reply({ ...voice, input: {}, output: {} });
      if (msg.cmd === 'SUBSCRIBE') return reply({ evt: 'VOICE_SETTINGS_UPDATE' });
      if (msg.cmd === 'SET_VOICE_SETTINGS') { voice = { ...voice, ...msg.args }; if (voice.deaf) voice.mute = true; return reply({ ...voice }); }
    }));
  });
  server.listen(sockPath);
  return {
    log, server,
    push: (v) => { voice = { ...voice, ...v }; client.write(encode(1, { cmd: 'DISPATCH', evt: 'VOICE_SETTINGS_UPDATE', data: { ...voice } })); },
    close: () => new Promise((r) => { if (client) client.destroy(); server.close(r); })
  };
}

(async () => {
  console.log('Discord voice');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-'));
  const sockPath = path.join(dir, 'ipc');
  const connect = (p) => (/discord-ipc-0$/.test(p) ? net.createConnection(sockPath) : (() => { const s = new net.Socket(); setImmediate(() => s.emit('error', new Error('ENOENT'))); return s; })());

  await check('first run: handshake, Authorize in Discord, token, then live mute / deaf', async () => {
    const fake = fakeDiscord(sockPath);
    const stored = { clientId: '123456789012345678', clientSecret: 'shh' };
    const tokenCalls = [];
    const fetchFn = async (url, init) => { tokenCalls.push(Object.fromEntries(new URLSearchParams(init.body))); return { ok: true, status: 200, json: async () => ({ access_token: 'good-token', refresh_token: 'r1', expires_in: 604800 }) }; };
    const dv = new DiscordVoice({ load: () => stored, save: (p) => Object.assign(stored, p), fetch: fetchFn, connect, retryMs: 50 });
    const states = [];
    dv.on('state', (s) => states.push(s.status));
    dv.start();
    await until(() => dv.state.status === 'live');
    assert.ok(states.includes('authorize'), 'asked to authorize');
    assert.deepStrictEqual(fake.log[0], ['HANDSHAKE', '123456789012345678']);
    assert.strictEqual(tokenCalls[0].grant_type, 'authorization_code');
    assert.strictEqual(tokenCalls[0].code, 'the-code');
    assert.strictEqual(tokenCalls[0].redirect_uri, 'http://localhost');
    assert.strictEqual(stored.accessToken, 'good-token');
    assert.ok(fake.log.some(([c, a]) => c === 'AUTHORIZE' && a.scopes.includes('rpc.voice.read') && a.scopes.includes('rpc.voice.write')));
    // Changed in Discord (or on the Stream Deck): the deck hears it.
    fake.push({ mute: true });
    await until(() => dv.state.mute === true);
    // Toggled from the deck.
    await dv.set({ deaf: true });
    assert.strictEqual(dv.state.deaf, true);
    assert.strictEqual(dv.state.mute, true);
    await dv.set({ deaf: false, mute: false });
    assert.strictEqual(dv.state.deaf, false);
    dv.stop();
    await fake.close();
  });

  await check('next run: the saved token signs straight in (no Authorize box)', async () => {
    const fake = fakeDiscord(sockPath);
    const stored = { clientId: '123456789012345678', clientSecret: 'shh', accessToken: 'good-token', refreshToken: 'r1', expiresAt: Date.now() + 5 * 864e5 };
    const dv = new DiscordVoice({ load: () => stored, save: (p) => Object.assign(stored, p), fetch: async () => { throw new Error('no token call expected'); }, connect, retryMs: 50 });
    dv.start();
    await until(() => dv.state.status === 'live');
    assert.ok(!fake.log.some(([c]) => c === 'AUTHORIZE'));
    dv.stop();
    await fake.close();
  });

  await check('Discord not running: waits, then connects when it starts', async () => {
    const stored = { clientId: '123456789012345678', clientSecret: 'shh', accessToken: 'good-token', expiresAt: Date.now() + 5 * 864e5 };
    const dv = new DiscordVoice({ load: () => stored, save: (p) => Object.assign(stored, p), connect, retryMs: 60 });
    dv.start();
    await until(() => dv.state.status === 'waiting');
    await assert.rejects(() => dv.set({ mute: true }), /isn't running/);
    const fake = fakeDiscord(sockPath);
    await until(() => dv.state.status === 'live', 3000);
    dv.stop();
    await fake.close();
  });

  await check('no codes yet: stays off and says how to set it up', async () => {
    const dv = new DiscordVoice({ load: () => ({}), save: () => {}, connect });
    dv.start();
    assert.strictEqual(dv.state.status, 'off');
    await assert.rejects(() => dv.set({ mute: true }), /Settings/);
  });

  console.log(`\n${pass} checks passed`);
  fs.rmSync(dir, { recursive: true, force: true });
})();
