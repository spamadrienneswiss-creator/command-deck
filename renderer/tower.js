// Comm Tower 1 (v1.27): click the button (or Ctrl + Alt + T) and a small terminal pops up
// above it. What you type goes to the deck window, which does the work and sends the
// reply lines back here. The window can take keyboard focus only while the terminal is open.

const $ = (s) => document.querySelector(s);
const T = window.tower;
const body = document.body;
const chip = $('#chip');
const pop = $('#pop');
const log = $('#log');
const input = $('#input');

let name = 'COMM TOWER 1';
let operator = '';
const lines = [];
let busy = false;
let hist = [];
let histAt = -1;
let idle = null;
const IDLE_MS = 60 * 1000;

const isOpen = () => !pop.hidden;
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function render() {
  const out = lines.map((e) => {
    if (e.k === 'card') {
      const c = el('div', 'card');
      c.appendChild(el('div', 'ck', e.head));
      if (e.fields && e.fields.length) {
        const kv = el('div', 'kv');
        for (const [k, v] of e.fields) { kv.appendChild(el('span', '', k)); kv.appendChild(el('span', '', v)); }
        c.appendChild(kv);
      }
      return c;
    }
    const d = el('div', `ln ${e.k}`);
    d.appendChild(el('span', 'pr', e.k === 'you' ? '> ' : '› '));
    d.appendChild(document.createTextNode(e.t));
    return d;
  });
  if (busy) { const b = el('div', 'ln busy'); b.appendChild(el('span', 'pr', '› ')); b.appendChild(document.createTextNode('…')); out.push(b); }
  log.replaceChildren(...out);
  log.scrollTop = log.scrollHeight;
}
function add(e) {
  lines.push(e);
  while (lines.length > 40) lines.shift();
  render();
  armIdle();
}
function armIdle() {
  clearTimeout(idle);
  if (isOpen()) idle = setTimeout(() => { if (!input.value && !busy) close(); }, IDLE_MS);
}

function open() {
  if (!lines.length) add({ k: 'c', t: `Go ahead${operator ? `, ${operator}` : ''}.` });
  pop.hidden = false;
  body.classList.add('open');
  T.focus(true);
  setTimeout(() => input.focus(), 30);
  render();
  armIdle();
}
function close() {
  clearTimeout(idle);
  pop.hidden = true;
  body.classList.remove('open');
  input.blur();
  T.focus(false);
}

function send(text) {
  text = String(text || '').trim();
  if (!text) return;
  hist = [text, ...hist.filter((h) => h !== text)].slice(0, 30);
  histAt = -1;
  T.send(text); // the deck echoes it back as a "you" line, then the reply
  armIdle();
}

T.onConfig((c) => {
  name = c.name || 'COMM TOWER 1';
  operator = c.operator || '';
  $('#name').textContent = name;
  $('#ptitle').textContent = name;
  document.title = name;
  chip.setAttribute('aria-label', `Open ${name}`);
});
T.onState((st) => {
  if (st.line) add(st.line);
  if (typeof st.busy === 'boolean') { busy = st.busy; body.classList.toggle('busy', busy); render(); }
});
T.onOpen(() => (isOpen() ? input.focus() : open()));

// The window is sized to what's showing, plus room for the glow.
const PAD = 18;
const tw = $('.tw');
const fit = () => { const r = tw.getBoundingClientRect(); T.size(Math.ceil(r.width) + PAD * 2, Math.ceil(r.height) + PAD * 2); };
new ResizeObserver(fit).observe(tw);

$('#form').addEventListener('submit', (e) => { e.preventDefault(); const v = input.value; input.value = ''; send(v); });
input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  if (e.key === 'ArrowUp' && hist.length) { e.preventDefault(); histAt = Math.min(hist.length - 1, histAt + 1); input.value = hist[histAt]; }
  if (e.key === 'ArrowDown' && histAt >= 0) { e.preventDefault(); histAt -= 1; input.value = histAt >= 0 ? hist[histAt] : ''; }
  armIdle();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });
$('#esc').addEventListener('click', close);
$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (!b) return;
  if (b.dataset.fill) { input.value = b.dataset.cmd; input.focus(); return; }
  send(b.dataset.cmd);
});

// Click to open / close; press and drag to move.
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
  if (p.moved) { T.drag('end', e.screenX, e.screenY); body.classList.remove('dragging'); return; }
  if (isOpen()) close(); else open();
});
chip.addEventListener('pointercancel', () => { if (press && press.moved) body.classList.remove('dragging'); press = null; });
chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (isOpen()) close(); else open(); } });
chip.addEventListener('click', (e) => e.preventDefault());

render();
