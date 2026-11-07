// Comm Tower 1: the chip on the main monitor. It only shows; the deck window does the
// listening, transcribing and filing, and sends each step here through the main process.
//   state.stage: idle | open (listening) | thinking | heard | reply
//   state.level (0–1 while listening), state.you (what it heard), state.text (the reply),
//   state.kind ('ok' | 'err' | 'c'), state.tags ([{ t, k }]), state.speaking (bool)

const $ = (s) => document.querySelector(s);
const T = window.tower;
const body = document.body;
const chip = $('#chip');
const card = $('#card');
const link = $('#link');

const SUB = { idle: 'STANDING BY', open: 'LISTENING TO YOU', thinking: 'COPYING…', heard: 'COPYING…', reply: 'ON THE LINE' };
const IDLE = [3, 4, 6, 9, 12, 14, 12, 9, 6, 4, 3];
const SPEAK = [5, 12, 20, 28, 34, 24, 32, 26, 18, 10, 5];
let name = 'COMM TOWER 1';

// Voiceprint bars in the portrait, and the live wave on the card.
const voice = $('#voice');
// Built with the DOM (not HTML strings) so no inline style attributes are needed.
const bar = (host, k) => { const i = document.createElement('i'); i.style.setProperty('--k', String(k)); host.appendChild(i); return i; };
const vbars = IDLE.map((_h, k) => bar(voice, k));
const wave = $('#wave');
const wbars = Array.from({ length: 32 }, (_x, k) => bar(wave, k));
let hist = new Array(32).fill(0);

function setBars(list, heights) { list.forEach((b, i) => b.style.setProperty('--h', `${heights[i]}px`)); }
function level(v) {
  hist = hist.slice(1).concat(v);
  wbars.forEach((b, i) => b.style.setProperty('--h', `${3 + Math.round(hist[i] * 23)}px`));
  const mid = 5;
  setBars(vbars, IDLE.map((_h, i) => 3 + Math.round(v * 30 * (1 - Math.abs(i - mid) / 7))));
}
const clock = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function showCard(mode, who, time, text, tags = []) {
  if (!mode) { card.hidden = true; link.hidden = true; return; }
  card.hidden = false;
  link.hidden = false;
  card.className = `tw-card${mode === 'you' || mode === 'live' ? ' you' : ''}${mode === 'live' ? ' live' : ''}`;
  link.className = `tw-link${mode === 'you' || mode === 'live' ? ' you' : ''}`;
  $('#who').textContent = who;
  $('#time').textContent = time;
  $('#text').textContent = text || '';
  const tg = $('#tags');
  tg.replaceChildren(...tags.map((g) => { const sp = document.createElement('span'); if (g.k) sp.className = g.k; sp.textContent = g.t; return sp; }));
}

function render(st) {
  const stage = st.stage || 'idle';
  body.dataset.stage = stage;
  body.dataset.kind = st.kind || '';
  body.classList.toggle('speaking', !!st.speaking);
  $('#sub').textContent = stage === 'reply' && st.speaking ? 'SPEAKING' : SUB[stage] || SUB.idle;
  chip.setAttribute('aria-label', stage === 'open' ? 'Finish talking' : `Talk to ${name}`);
  if (stage === 'open') {
    if (typeof st.level === 'number') { level(st.level); return; }
    hist = new Array(32).fill(0);
    level(0);
    showCard('live', 'YOU', 'LIVE', 'Go ahead…');
  } else if (stage === 'thinking') {
    setBars(vbars, IDLE);
    showCard('you', 'YOU', clock(), 'Copying that down…');
  } else if (stage === 'heard') {
    setBars(vbars, IDLE);
    showCard('you', 'YOU', clock(), `“${st.you}”`);
  } else if (stage === 'reply') {
    setBars(vbars, SPEAK);
    showCard('reply', name, clock(), st.text, st.tags || []);
  } else {
    setBars(vbars, IDLE);
    showCard(null);
  }
}

T.onConfig((c) => {
  name = c.name || 'COMM TOWER 1';
  $('#name').textContent = name;
  document.title = name;
  if (!card.hidden && body.dataset.stage === 'reply') $('#who').textContent = name;
});
T.onState(render);

// Clicks reach the window only over the chip and the card; everywhere else passes through.
let over = false;
const hit = (v) => { if (v !== over) { over = v; T.hit(v); } };
for (const el of [chip, card]) {
  el.addEventListener('mouseenter', () => hit(true));
  el.addEventListener('mouseleave', () => { if (!body.classList.contains('dragging')) hit(false); });
}
// Clicking the card puts it away.
card.addEventListener('click', () => { if (body.dataset.stage === 'reply' || body.dataset.stage === 'idle') render({ stage: 'idle' }); });

// Click to talk (or to finish); press and drag to move the chip.
let press = null;
chip.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  press = { x: e.screenX, y: e.screenY, moved: false };
  chip.setPointerCapture(e.pointerId);
});
chip.addEventListener('pointermove', (e) => {
  if (!press) return;
  if (!press.moved && Math.hypot(e.screenX - press.x, e.screenY - press.y) > 5) {
    press.moved = true;
    body.classList.add('dragging');
    T.drag('start', press.x, press.y);
  }
  if (press.moved) T.drag('move', e.screenX, e.screenY);
});
chip.addEventListener('pointerup', (e) => {
  if (!press) return;
  const p = press;
  press = null;
  if (p.moved) {
    T.drag('end', e.screenX, e.screenY);
    body.classList.remove('dragging');
  } else {
    T.talk();
  }
});
chip.addEventListener('pointercancel', () => { if (press && press.moved) { body.classList.remove('dragging'); } press = null; });
// Keyboard: Enter / Space on the focused chip also talks (pointer clicks are handled above).
chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); T.talk(); } });
chip.addEventListener('click', (e) => e.preventDefault());

render({ stage: 'idle' });
