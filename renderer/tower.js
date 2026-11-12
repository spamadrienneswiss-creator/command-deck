// Comm Tower 1 (v1.31): the dial. A glowing core that opens into a fan of keys: record a
// meeting, the typing terminal, the web browser, a note, File Explorer, and your own
// shortcuts. Click the core (or press Ctrl + Alt + T) to open it; Esc closes it.
// The window is only as big as what shows, in one of three states:
//   closed  the core            open  the fan of keys            term  the core + the pop-up terminal
// What you type still goes to the deck window, which does the work and sends the reply here.

const $ = (s) => document.querySelector(s);
const T = window.tower;
const body = document.body;
const chip = $('#chip');
const pop = $('#pop');
const log = $('#log');
const input = $('#input');
const keysEl = $('#keys');
const hud = $('#hud');
const SVG = 'http://www.w3.org/2000/svg';

let name = 'COMM TOWER 1';
let operator = '';
let skin = 'eclipse';
let style = 'sentinel'; // sentinel | obsidian | lantern (Settings › System › COMM TOWER 1 › DIAL STYLE)
let themeColors = null;
let shortcuts = [];
let maxShortcuts = 5;
const lines = [];
let busy = false;
let hist = [];
let histAt = -1;
let idle = null;
const IDLE_MS = 60 * 1000;
const FAN_IDLE_MS = 25 * 1000;

let state = 'closed'; // closed | open | term
let lay = { hx: 64, hy: 64, h: 'r', v: 'u', pin: null };
let openedAt = 0;
let seq = 0; // bumps on every state change, so a late timer from an old one does nothing

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function svg(tag, attrs = {}, cls) { const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (cls) e.setAttribute('class', cls); return e; }

// ---------------------------------------------------------------- the rings
// Dense concentric rings around the hub (0, 0). The inner three stay with the closed core;
// the rest sweep out when the dial opens. Mirrored as a group when the fan opens left or down.
const A0 = 8; // the first key sits just below level; each next one climbs STEP degrees
const STEP = 21.2;
const R_KEY = 240;
const R_SMALL = 152;
const mir = svg('g');
const sel = svg('g', {}, 'sel');
const leads = svg('g');
function ring({ r, w = 1, dash, col = 'p', op = 1, spin = 0, rev = false, d = 0, alt = false, rot = null, inner = false }) {
  const c = svg('circle', { cx: 0, cy: 0, r, fill: 'none', 'stroke-opacity': op, 'stroke-width': w }, `rg c-${col}${alt ? ' alt' : ''}${inner ? ' in' : ''}`);
  if (dash) c.setAttribute('stroke-dasharray', dash);
  c.style.setProperty('--d', `${d}s`);
  let node = c;
  if (rot != null) { node = svg('g', { transform: `rotate(${rot})` }); node.appendChild(c); }
  if (spin) {
    const g = svg('g', {}, `spin${inner ? '' : ' far'}`);
    g.style.animationDuration = `${spin}s`;
    if (rev) g.style.animationDirection = 'reverse';
    g.appendChild(node);
    node = g;
  }
  return node;
}
function buildHud() {
  const band = R_KEY * ((5 * STEP + 19.5) * Math.PI / 180);
  [
    { r: 98, w: 3, dash: '150 466', spin: 14, d: 0.1, inner: true },
    { r: 98, w: 3, dash: '60 556', col: 'a', spin: 22, rev: true, d: 0.1, alt: true, inner: true },
    { r: 112, dash: '3 4', op: 0.7, spin: 70, d: 0.12, inner: true },
    { r: 150, w: 9, dash: '1.5 7.92', op: 0.4, spin: 120, d: 0.2 },
    { r: 176, op: 0.5, d: 0.25, alt: true },
    { r: R_KEY, w: 84, dash: `${band.toFixed(0)} 9999`, op: 0.07, d: 0.3, rot: A0 - 5 * STEP - 9.75 },
    { r: 198, op: 0.7, d: 0.3 },
    { r: 282, op: 0.7, d: 0.35, alt: true },
    { r: 294, w: 8, dash: '1.5 6.2', col: 'a', op: 0.7, spin: 150, rev: true, d: 0.4 },
    { r: 334, w: 1.5, dash: '230 30 80 30', op: 0.7, spin: 90, rev: true, d: 0.5 },
    { r: 350, op: 0.25, d: 0.55 }
  ].forEach((o) => mir.appendChild(ring(o)));
  // The selector: two accent arcs that swing round to the key under the pointer.
  sel.appendChild(svg('circle', { cx: 0, cy: 0, r: 288, fill: 'none', 'stroke-width': 6, 'stroke-dasharray': '92 9999', transform: 'rotate(-1.2)' }, 'c-a'));
  sel.appendChild(svg('circle', { cx: 0, cy: 0, r: 193, fill: 'none', 'stroke-width': 2.5, 'stroke-dasharray': '62 9999', transform: 'rotate(-1.2)' }, 'c-a'));
  mir.appendChild(sel);
  mir.appendChild(leads);
  hud.appendChild(mir);
  // Lettering round the outside. Not mirrored, so it always reads the right way.
  const spinG = svg('g', {}, 'spin far');
  spinG.style.animationDuration = '130s';
  const g = svg('g', {}, 'rg');
  g.style.setProperty('--d', '0.45s');
  g.appendChild(svg('path', { id: 'dlTxt', d: 'M0 -310 A310 310 0 1 1 -0.01 -310', fill: 'none' }));
  const text = svg('text');
  const tp = svg('textPath', { href: '#dlTxt' });
  tp.id = 'arcText';
  text.appendChild(tp);
  g.appendChild(text);
  spinG.appendChild(g);
  hud.appendChild(spinG);
  // Obsidian: an instrument bezel. Ticks every 5°, bearing numbers that drift round.
  const ob = svg('g', {}, 'st-ob rg');
  ob.style.setProperty('--d', '0.32s');
  for (let k = 0; k < 72; k++) {
    const a = k * 5 * Math.PI / 180;
    const major = k % 6 === 0;
    const r1 = major ? 252 : 258; const r2 = major ? 270 : 266;
    ob.appendChild(svg('line', { x1: (r1 * Math.cos(a)).toFixed(1), y1: (r1 * Math.sin(a)).toFixed(1), x2: (r2 * Math.cos(a)).toFixed(1), y2: (r2 * Math.sin(a)).toFixed(1), 'stroke-width': major ? 1.2 : 0.6 }, 'ob-tick'));
  }
  hud.appendChild(ob);
  const obSpin = svg('g', {}, 'st-ob spin far');
  obSpin.style.animationDuration = '200s';
  obSpin.style.animationDirection = 'reverse';
  const obNums = svg('g', {}, 'rg alt');
  obNums.style.setProperty('--d', '0.5s');
  for (let k = 0; k < 12; k++) {
    const a = (k * 30 - 90) * Math.PI / 180;
    const t = svg('text', { x: (342 * Math.cos(a)).toFixed(1), y: (342 * Math.sin(a) + 2.5).toFixed(1), 'text-anchor': 'middle' }, 'ob-num');
    t.textContent = String(k * 30).padStart(3, '0');
    obNums.appendChild(t);
  }
  obSpin.appendChild(obNums);
  hud.appendChild(obSpin);
  // Lantern: two more ring planes, one behind and one in front, for depth.
  const h2 = $('#hud2'); const h3 = $('#hud3');
  [{ r: 186, dash: '2 5', op: 0.55, d: 0.22, alt: true, spin: 160, rev: true }, { r: 260, op: 0.35, d: 0.3 }, { r: 352, dash: '1 6', op: 0.3, d: 0.5, spin: 220 }].forEach((o) => h2.appendChild(ring(o)));
  [{ r: 132, w: 1.5, dash: '40 300', op: 0.9, d: 0.18, spin: 30 }, { r: 216, dash: '6 10', col: 'a', op: 0.8, d: 0.3, alt: true, spin: 110, rev: true }, { r: 304, dash: '1 4', op: 0.6, d: 0.42, spin: 240, rev: true }].forEach((o) => h3.appendChild(ring(o)));
  arcText();
}
function arcText() {
  const tp = $('#arcText');
  if (tp) tp.textContent = `SENTINEL ARRAY // ${name} // QUADRANT LOCK // `.repeat(3);
}

// ---------------------------------------------------------------- the keys
const ICON = {
  record: 'M12 6.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11ZM12 10.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 1 0 0-3.6Z',
  terminal: 'M5 8l4 4-4 4M12 16h7',
  browser: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18ZM3 12h18M12 3c3.2 3 3.2 15 0 18M12 3c-3.2 3-3.2 15 0 18',
  note: 'M6 4h9l3 3v13H6ZM9 10.5h6M9 14.5h6',
  files: 'M3 7h6l2 2h10v10H3Z',
  add: 'M12 5v14M5 12h14'
};
const MAIN = [
  { id: 'record', label: 'RECORD', sub: 'START A RECAP', cls: 'rec' },
  { id: 'terminal', label: 'TERMINAL', sub: 'TYPE A COMMAND' },
  { id: 'browser', label: 'BROWSER', sub: 'OPEN THE WEB' },
  { id: 'note', label: 'NOTE', sub: 'JOT IT DOWN' },
  { id: 'files', label: 'FILES', sub: 'FILE EXPLORER' },
  { id: 'add', label: 'ADD', sub: 'YOUR OWN SHORTCUT' }
];
const KIND_SUB = { web: 'WEBSITE', app: 'PROGRAM', folder: 'FOLDER' };
let keyList = []; // what's on the dial now: the six, then your shortcuts on the inner arc
function monogram(n) {
  const words = String(n || '').trim().split(/\s+/).filter(Boolean);
  const m = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2);
  return m.toUpperCase();
}
function buildKeys() {
  const sx = lay.h === 'l' ? -1 : 1;
  const sy = lay.v === 'd' ? -1 : 1;
  mir.setAttribute('transform', `scale(${sx} ${sy})`);
  keyList = [
    ...MAIN.map((k, i) => ({ ...k, ang: A0 - STEP * i, r: R_KEY, slot: i })),
    ...shortcuts.slice(0, maxShortcuts).map((s, j) => ({ id: `sc:${s.id}`, label: String(s.name || '').toUpperCase(), sub: KIND_SUB[s.kind] || 'SHORTCUT', small: true, mono: monogram(s.name), ang: A0 - STEP * (j + 0.5), r: R_SMALL, slot: j + 0.5 }))
  ];
  const out = keyList.map((k, i) => {
    const b = el('button', `dl-key${k.cls ? ` ${k.cls}` : ''}${k.small ? ' sm' : ''}`);
    b.type = 'button';
    b.dataset.key = k.id;
    b.dataset.i = String(i);
    b.setAttribute('aria-label', k.small ? `${k.label} (${k.sub.toLowerCase()})` : k.label);
    b.tabIndex = -1;
    const a = k.ang * Math.PI / 180;
    b.style.setProperty('--kx', `${(Math.cos(a) * k.r * sx).toFixed(1)}px`);
    b.style.setProperty('--ky', `${(Math.sin(a) * k.r * sy).toFixed(1)}px`);
    b.style.setProperty('--kd', `${(k.small ? 1.5 + k.slot * 0.1 : 1.1 + k.slot * 0.12).toFixed(2)}s`);
    const inn = el('span', 'in');
    if (k.small) inn.appendChild(el('b', '', k.mono));
    else {
      const s = svg('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
      s.appendChild(svg('path', { d: ICON[k.id] }));
      inn.appendChild(s);
      const lab = el('b', '', k.label);
      if (k.id === 'record') lab.id = 'recKeyLab';
      inn.appendChild(lab);
    }
    b.appendChild(inn);
    return b;
  });
  keysEl.replaceChildren(...out);
  // Obsidian's three ember bearings on the bezel, and Lantern's light dust, both in the fan's direction.
  $('#seams').replaceChildren(...[-96, -42, 12].map((deg) => {
    const i = el('i');
    const a = deg * Math.PI / 180;
    i.style.transform = `translate(${(126 * Math.cos(a) * sx).toFixed(1)}px, ${(126 * Math.sin(a) * sy).toFixed(1)}px)`;
    return i;
  }));
  let seed = 7;
  const rnd = (lo, hi) => { seed = (seed * 16807) % 2147483647; return lo + (hi - lo) * ((seed - 1) / 2147483646); };
  $('#dust').replaceChildren(...Array.from({ length: 26 }, (_v, k) => {
    const i = el('i', k % 7 === 0 ? 'o' : '');
    const a = rnd(-1.75, 0.35); const rr = rnd(110, 340);
    i.style.left = `${(Math.cos(a) * rr * sx).toFixed(0)}px`;
    i.style.top = `${(Math.sin(a) * rr * sy).toFixed(0)}px`;
    i.style.setProperty('--dx', `${rnd(-26, 26).toFixed(0)}px`);
    i.style.setProperty('--dy', `${(rnd(-40, -8) * sy).toFixed(0)}px`);
    i.style.animationDuration = `${rnd(5, 11).toFixed(1)}s`;
    i.style.animationDelay = `${rnd(-10, 0).toFixed(1)}s`;
    return i;
  }));
  // Lead lines from the hub out to each of the six.
  leads.replaceChildren(...MAIN.map((_k, i) => {
    const a = (A0 - STEP * i) * Math.PI / 180;
    const p = svg('path', { d: `M${(122 * Math.cos(a)).toFixed(1)} ${(122 * Math.sin(a)).toFixed(1)} L${(196 * Math.cos(a)).toFixed(1)} ${(196 * Math.sin(a)).toFixed(1)}` }, 'ld');
    p.style.setProperty('--d', `${(0.9 + i * 0.1).toFixed(2)}s`);
    return p;
  }));
  paintRecKey();
  const add = keysEl.querySelector('[data-key="add"]');
  if (add) add.classList.toggle('off', false);
}
let hover = -1;
function setHover(i) {
  hover = i;
  [...keysEl.children].forEach((b, n) => b.classList.toggle('hot', n === i));
  const k = keyList[i];
  sel.classList.toggle('on', !!k);
  if (k) sel.style.transform = `rotate(${(-(k.slot) * STEP).toFixed(1)}deg)`;
  say();
}
function say() {
  const k = keyList[hover];
  const on = recOn();
  $('#sayTop').textContent = k ? (k.id === 'record' && on ? 'RECORDING' : k.label) : name;
  $('#saySub').textContent = k ? (k.id === 'record' && on ? `${hms(recClock())} · OPEN CONTROLS` : k.sub) : on ? `REC ${hms(recClock())}` : operator ? `AT YOUR SERVICE, ${operator.toUpperCase()}` : 'AT YOUR SERVICE';
}
keysEl.addEventListener('pointerover', (e) => { const b = e.target.closest('.dl-key'); if (b) { setHover(Number(b.dataset.i)); armFan(); } });
keysEl.addEventListener('pointerleave', () => setHover(-1));
keysEl.addEventListener('click', (e) => { const b = e.target.closest('.dl-key'); if (b) pick(b.dataset.key); });

// ---------------------------------------------------------------- states
function applyLayout(l) {
  lay = { ...lay, ...l };
  body.style.setProperty('--hx', `${lay.hx}px`);
  body.style.setProperty('--hy', `${lay.hy}px`);
  const flipped = body.dataset.h !== lay.h || body.dataset.v !== lay.v;
  body.dataset.h = lay.h;
  body.dataset.v = lay.v;
  body.style.setProperty('--sy', lay.v === 'd' ? '-1' : '1');
  if (lay.pin) body.dataset.pin = lay.pin; else delete body.dataset.pin;
  body.dataset.state = l.state || state;
  if (flipped) buildKeys();
}
T.onLayout((l) => {
  clearTimeout(layoutWait);
  applyLayout(l);
  if (l.state === 'open' && state === 'open' && !body.classList.contains('open')) {
    // The window is in place: a moment later, let the dial unfold. (A timer, not animation
    // frames: Windows can stop handing frames to a see-through window it thinks is hidden,
    // and then the dial would never open.)
    const mine = seq;
    setTimeout(() => {
      if (mine !== seq) return;
      body.classList.add('open');
      setTimeout(() => { if (mine === seq) body.classList.add('settled'); }, 2600);
    }, 40);
  }
});
// If the main process never answers a layout request, don't sit there half-open: reset to
// the closed core and ask again, so the next click works.
let layoutWait = null;
function askLayout(next, popH) {
  T.layout(next, popH);
  clearTimeout(layoutWait);
  layoutWait = setTimeout(() => {
    state = 'closed'; seq += 1;
    body.classList.remove('open', 'settled');
    pop.hidden = true;
    chip.setAttribute('aria-expanded', 'false');
    T.layout('closed');
    T.focus(false);
  }, 2000);
}
function go(next) { state = next; seq += 1; chip.setAttribute('aria-expanded', String(next !== 'closed')); }
let fanIdle = null;
function armFan() {
  clearTimeout(fanIdle);
  if (state === 'open') fanIdle = setTimeout(() => { if (state === 'open') closeAll(); }, FAN_IDLE_MS);
}
function openDial() {
  if (state === 'open') return;
  hidePop();
  go('open');
  openedAt = Date.now();
  setHover(-1);
  askLayout('open');
  T.focus(true);
  armFan();
}
// Fold the fan away, then (after) shrink the window to whatever comes next.
function foldThen(fn) {
  const mine = seq;
  const wasOpen = body.classList.contains('open');
  body.classList.remove('open', 'settled');
  setHover(-1);
  clearTimeout(fanIdle);
  if (!wasOpen) { fn(); return; }
  setTimeout(() => { if (mine === seq) fn(); }, 380);
}
function closeAll() {
  hidePop();
  go('closed');
  foldThen(() => { askLayout('closed'); T.focus(false); });
}
function hidePop() {
  clearTimeout(idle);
  pop.hidden = true;
  input.blur();
}
// The pop-up terminal. opts: { rec } the recording box, { add } the shortcut box, { fill } text to start with.
function showTerm(opts = {}) {
  go('term');
  foldThen(() => {
    if (!lines.length) add({ k: 'c', t: `Go ahead${operator ? `, ${operator}` : ''}.` });
    askLayout('term', 400);
    T.focus(true);
    pop.hidden = false;
    recSetup.hidden = !(opts.rec && !recOn());
    scBox.hidden = !opts.add;
    if (opts.add) { scReset(); setTimeout(() => $('#scTarget').focus(), 40); }
    else if (opts.rec && !recOn()) { $('#recTitle').value = ''; setTimeout(() => $('#recTitle').focus(), 40); }
    else { if (opts.fill) input.value = opts.fill; setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 40); }
    render();
    armIdle();
  });
}
function pick(id) {
  if (state !== 'open') return;
  if (id === 'record') return showTerm({ rec: true });
  if (id === 'terminal') return showTerm();
  if (id === 'note') return showTerm({ fill: 'take a note: ' });
  if (id === 'add') return showTerm({ add: true });
  if (id === 'browser' || id === 'files') T.launch(id);
  else if (id.startsWith('sc:')) T.launch('shortcut', id.slice(3));
  closeAll();
}

// ---------------------------------------------------------------- the pop-up terminal
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
  if (state === 'term') idle = setTimeout(() => { if (state === 'term' && !input.value && !busy && recSetup.hidden && scBox.hidden) closeAll(); }, IDLE_MS);
}
function send(text) {
  text = String(text || '').trim();
  if (!text) return;
  hist = [text, ...hist.filter((h) => h !== text)].slice(0, 30);
  histAt = -1;
  T.send(text); // the deck echoes it back as a "you" line, then the reply
  armIdle();
}

// ---------------------------------------------------------------- colors
function applySkin() {
  body.dataset.skin = skin;
  const vars = ['--p', '--s', '--a', '--a-soft', '--t'];
  if (skin === 'theme' && themeColors && themeColors.p) {
    body.style.setProperty('--p', themeColors.p);
    body.style.setProperty('--s', themeColors.s || themeColors.p);
    body.style.setProperty('--a', themeColors.a || themeColors.p);
    body.style.setProperty('--a-soft', `color-mix(in srgb, ${themeColors.a || themeColors.p} 55%, #FFFFFF)`);
    body.style.setProperty('--t', `color-mix(in srgb, ${themeColors.p} 25%, #FFFFFF)`);
  } else vars.forEach((v) => body.style.removeProperty(v));
}

T.onConfig((c) => {
  name = c.name || 'COMM TOWER 1';
  operator = c.operator || '';
  skin = c.skin || 'eclipse';
  style = ['obsidian', 'lantern'].includes(c.style) ? c.style : 'sentinel';
  body.dataset.style = style;
  shortcuts = Array.isArray(c.shortcuts) ? c.shortcuts : [];
  maxShortcuts = c.max || 5;
  $('#ptitle').textContent = name;
  document.title = name;
  chip.setAttribute('aria-label', `Open ${name}`);
  arcText();
  applySkin();
  buildKeys();
  scList();
  say();
});
T.onState((st) => {
  if (st.line) add(st.line);
  if (typeof st.busy === 'boolean') { busy = st.busy; body.classList.toggle('busy', busy); render(); }
  if (st.rec) showRec(st.rec);
  if (st.theme) { themeColors = st.theme; applySkin(); }
});

// ---- record a meeting (v1.28): set up → recording → STOP + RECAP. Opened from the Record key.
const recSetup = $('#recSetup');
const recLive = $('#recLive');
let rec = { state: 'idle' };
let recTick = null;
const two = (n) => String(n).padStart(2, '0');
const hms = (ms) => { const t = Math.floor(ms / 1000); const h = Math.floor(t / 3600); return h ? `${h}:${two(Math.floor(t / 60) % 60)}:${two(t % 60)}` : `${two(Math.floor(t / 60))}:${two(t % 60)}`; };
const BARS = 8;
for (const m of ['#mSys', '#mMic']) { const b = $(`${m} .tw-bars`); for (let i = 0; i < BARS; i++) { const e = el('i'); e.style.height = `${4 + i}px`; b.appendChild(e); } }
function meter(sel2, v) { const n = Math.round(Math.min(1, v || 0) * BARS); [...$(`${sel2} .tw-bars`).children].forEach((b, i) => b.classList.toggle('on', i < n)); }
let recBase = { at: 0, elapsed: 0 };
function recOn() { return ['recording', 'paused', 'starting', 'stopping'].includes(rec.state); }
function recClock() { return rec.state === 'recording' ? recBase.elapsed + (Date.now() - recBase.at) : rec.elapsed || 0; }
function paintRecKey() {
  const lab = $('#recKeyLab');
  if (lab) lab.textContent = recOn() ? (rec.state === 'paused' ? 'PAUSED' : hms(recClock())) : 'RECORD';
}
function showRec(r) {
  rec = { ...rec, ...r };
  if (r.levels) { meter('#mSys', r.levels.sys); meter('#mMic', r.levels.mic); }
  if (typeof r.elapsed === 'number') recBase = { at: Date.now(), elapsed: r.elapsed };
  if (r.levels && !r.state) return;
  const on = recOn();
  body.classList.toggle('rec', on);
  body.classList.toggle('paused', rec.state === 'paused');
  pop.classList.toggle('rec', on);
  recLive.hidden = !on;
  if (on) recSetup.hidden = true;
  $('#recName').textContent = rec.title || 'Meeting';
  $('#mSys').classList.toggle('off', !(rec.sources && rec.sources.sys));
  $('#mMic').classList.toggle('off', !(rec.sources && rec.sources.mic));
  $('#recPause').textContent = rec.state === 'paused' ? 'RESUME' : 'PAUSE';
  $('#recPause').disabled = !['recording', 'paused'].includes(rec.state);
  clearInterval(recTick);
  const paint = () => {
    const t = hms(recClock());
    $('#recTime').textContent = rec.state === 'starting' ? '…' : t;
    $('#recBtnLab').textContent = on ? t : 'REC';
    $('#hubTime').textContent = on ? (rec.state === 'paused' ? 'PAUSED' : t) : '';
    paintRecKey();
    if (state === 'open') say();
  };
  paint();
  if (on) recTick = setInterval(paint, 500);
}
$('#recBtn').addEventListener('click', () => {
  if (recOn()) { recLive.scrollIntoView({ block: 'nearest' }); return; }
  recSetup.hidden = !recSetup.hidden;
  scBox.hidden = true;
  if (!recSetup.hidden) { $('#recTitle').value = ''; setTimeout(() => $('#recTitle').focus(), 20); }
  armIdle();
});
const startRec = () => {
  T.rec('start', { title: $('#recTitle').value.trim(), sys: $('#recSys').checked, mic: $('#recMic').checked });
  recSetup.hidden = true;
  input.focus();
};
$('#recStart').addEventListener('click', startRec);
$('#recTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); startRec(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); recSetup.hidden = true; input.focus(); } });
$('#recCancel').addEventListener('click', () => { recSetup.hidden = true; input.focus(); });
$('#recStop').addEventListener('click', () => T.rec('stop'));
$('#recPause').addEventListener('click', () => T.rec(rec.state === 'paused' ? 'resume' : 'pause'));
$('#recDiscard').addEventListener('click', () => {
  const b = $('#recDiscard');
  if (b.dataset.sure) { T.rec('discard'); delete b.dataset.sure; b.textContent = 'DISCARD'; return; }
  b.dataset.sure = '1';
  b.textContent = 'SURE? DISCARD';
  setTimeout(() => { delete b.dataset.sure; b.textContent = 'DISCARD'; }, 4000);
});

// ---- your own shortcuts (the + key): a website, a program, or a folder
const scBox = $('#scBox');
function scMsg(t) { const m = $('#scMsg'); m.textContent = t || ''; m.hidden = !t; }
function scReset() { $('#scTarget').value = ''; $('#scName').value = ''; scMsg(shortcuts.length >= maxShortcuts ? `The dial holds ${maxShortcuts} shortcuts. Remove one to add another.` : ''); }
function scList() {
  $('#scList').replaceChildren(...shortcuts.map((s) => {
    const row = el('div', 'tw-scrow');
    row.appendChild(el('i', '', KIND_SUB[s.kind] || 'SHORTCUT'));
    row.appendChild(el('span', '', s.name));
    const x = el('button', '', 'REMOVE');
    x.type = 'button';
    x.addEventListener('click', async () => { await T.shortcut({ action: 'remove', id: s.id }); scMsg(''); });
    row.appendChild(x);
    return row;
  }));
}
async function scPick(what) {
  const res = await T.shortcut({ action: 'pick', what });
  T.focus(true);
  if (res && res.ok) { $('#scTarget').value = res.path; $('#scName').focus(); }
  armIdle();
}
async function scSave() {
  const res = await T.shortcut({ action: 'add', target: $('#scTarget').value, name: $('#scName').value });
  if (!res || !res.ok) { scMsg((res && res.error) || 'That didn\'t work. Try again.'); return; }
  scBox.hidden = true;
  add({ k: 'ok', t: `${res.name} is on the dial.` });
  input.focus();
}
$('#scPickApp').addEventListener('click', () => scPick('program'));
$('#scPickDir').addEventListener('click', () => scPick('folder'));
$('#scSave').addEventListener('click', scSave);
$('#scCancel').addEventListener('click', () => { scBox.hidden = true; input.focus(); });
for (const id of ['#scTarget', '#scName']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); scSave(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); scBox.hidden = true; input.focus(); } armIdle(); });

// Ctrl + Alt + T from anywhere: open the dial (or close it again).
T.onOpen(() => { if (state === 'closed') openDial(); else if (state === 'term') input.focus(); else closeAll(); });

$('#form').addEventListener('submit', (e) => { e.preventDefault(); const v = input.value; input.value = ''; send(v); });
input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAll(); return; }
  if (e.key === 'ArrowUp' && hist.length) { e.preventDefault(); histAt = Math.min(hist.length - 1, histAt + 1); input.value = hist[histAt]; }
  if (e.key === 'ArrowDown' && histAt >= 0) { e.preventDefault(); histAt -= 1; input.value = histAt >= 0 ? hist[histAt] : ''; }
  armIdle();
});
// With the fan open: 1 to 6 press a key, Enter opens the terminal, the arrows walk the keys, Esc closes.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state !== 'closed') { closeAll(); return; }
  if (state !== 'open') return;
  armFan();
  const n = Number(e.key);
  if (n >= 1 && n <= MAIN.length) { e.preventDefault(); pick(MAIN[n - 1].id); return; }
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    e.preventDefault();
    const step = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? 1 : -1;
    setHover(Math.max(0, Math.min(MAIN.length - 1, (hover < 0 || hover >= MAIN.length ? (step > 0 ? -1 : MAIN.length) : hover) + step)));
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(keyList[hover] ? keyList[hover].id : 'terminal'); }
});
// Clicking away from the open fan folds it.
window.addEventListener('blur', () => { if (state === 'open' && Date.now() - openedAt > 700) closeAll(); });
$('#esc').addEventListener('click', closeAll);
$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (!b) return;
  if (b.dataset.fill) { input.value = b.dataset.cmd; input.focus(); return; }
  send(b.dataset.cmd);
});

// The core: click to open / close; press and drag (while closed) to move it.
let press = null;
chip.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  press = { x: e.screenX, y: e.screenY, moved: false };
  chip.setPointerCapture(e.pointerId);
});
chip.addEventListener('pointermove', (e) => {
  if (!press || state !== 'closed') return;
  if (!press.moved && Math.hypot(e.screenX - press.x, e.screenY - press.y) > 5) {
    press.moved = true;
    body.classList.add('dragging');
    T.drag('start', press.x, press.y);
  }
  if (press.moved) T.drag('move', e.screenX, e.screenY);
});
const toggle = () => { if (state === 'closed') openDial(); else closeAll(); };
chip.addEventListener('pointerup', (e) => {
  if (!press) return;
  const p = press;
  press = null;
  if (p.moved) { T.drag('end', e.screenX, e.screenY); body.classList.remove('dragging'); return; }
  toggle();
});
chip.addEventListener('pointercancel', () => { if (press && press.moved) body.classList.remove('dragging'); press = null; });
chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggle(); } });
chip.addEventListener('click', (e) => e.preventDefault());

buildHud();
buildKeys();
render();
say();

// For the screenshot runs in CI.
window.__dial = { open: openDial, close: closeAll, pick: (id) => { if (state !== 'open') { openDial(); } pick(id); }, state: () => state, hover: setHover };
