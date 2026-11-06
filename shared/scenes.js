// Painted themes: a painted backdrop with live layers drawn over it in CSS
// (shuttles, engine glow, twinkling lights, mist...). Used by the deck, Field Unit
// and the shared-link pages; the looks themselves live in shared/scenes.css.
//
// Layers are placed in % of the painting (16:9), so they stay on the right spot
// however the window crops it. `p: 1` marks layers that also run on phones (fewer,
// to keep them light). Painting coordinates come from the design board mockups
// (1440x900 deck: x% = (x + 80) / 16, y% = y / 9).

const deck = (x, y) => [+((x + 80) / 16).toFixed(2), +(y / 9).toFixed(2)];

function seeded(n) {
  let s = n;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}
function scatter(cls, n, seed, x0, x1, y0, y1, extra = {}) {
  const r = seeded(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = deck(x0 + r() * (x1 - x0), y0 + r() * (y1 - y0));
    out.push({ c: cls, x, y, d: -(r() * 6).toFixed(2), s: +(2.4 + r() * 3).toFixed(2), p: i % 3 === 0 ? 1 : 0, ...extra });
  }
  return out;
}

export const SCENES = {
  // A luxury starport observation lounge at dusk.
  concourse: {
    img: 'concourse.jpg', fx: 0.56,
    layers: [
      { c: 'cc-sun', ...xy(1384, 318), w: 26, p: 1 },
      { c: 'cc-eng', ...xy(938, 366), w: 2.75, p: 1 },
      { c: 'cc-eng', ...xy(938, 397), w: 2.75, d: -1.1, p: 1 },
      { c: 'cc-ship cc-l', ...xy(0, 232), w: 7.5, s: 34, p: 1 },
      { c: 'cc-ship cc-l', ...xy(0, 452), w: 5.6, s: 52, d: -20, o: 0.85 },
      { c: 'cc-ship cc-r', ...xy(0, 300), w: 4.4, s: 46, d: -8, o: 0.7 },
      ...scatter('cc-tw', 17, 5, 20, 540, 220, 550),
      ...scatter('cc-tw', 17, 11, 1110, 1430, 330, 530),
      ...scatter('cc-mote', 8, 7, 100, 1340, 700, 860, { s: 22, d: 0 }).map((m, i) => ({ ...m, d: -(i * 2.7).toFixed(1), s: 22 }))
    ]
  },
  // Looking down a canyon of rust-orange megastructures at dusk.
  spire: {
    img: 'spire.jpg', fx: 0.6,
    layers: [
      { c: 'sp-steam', ...xy(46, 282), w: 2.5, s: 5 },
      { c: 'sp-steam', ...xy(327, 365), w: 2.5, s: 5, d: -1.6, p: 1 },
      { c: 'sp-steam', ...xy(442, 204), w: 2.5, s: 5, d: -3, p: 1 },
      { c: 'sp-steam', ...xy(567, 214), w: 2.5, s: 5, d: -4.1 },
      { c: 'sp-red', ...xy(706, 427), p: 1 },
      { c: 'sp-red', ...xy(826, 302), d: -0.6, p: 1 },
      { c: 'sp-red', ...xy(1250, 220), d: -0.3 },
      { c: 'sp-craft sp-k1', ...xy(1300, 250), s: 30, p: 1 },
      { c: 'sp-craft sp-k2', ...xy(760, 520), s: 42, d: -14 },
      { c: 'sp-craft sp-k1 sm', ...xy(1200, 160), s: 36, d: -25, p: 1 },
      { c: 'sp-fog', ...xy(0, 650), w: 43.75, h: 20, s: 80, p: 1 },
      { c: 'sp-fog', ...xy(0, 720), w: 56.25, h: 22.2, s: 120, d: -50 }
    ]
  },
  // A dark penthouse office at night over a teal neon megacity.
  skyline: {
    img: 'skyline.jpg', fx: 0.5,
    layers: [
      { c: 'sk-aur', x: -7.5, y: 6.67, w: 118.75, h: 40, s: 22, p: 1 },
      { c: 'sk-holo', ...xy(0, 229), w: 11.4, h: 18.7, p: 1 },
      { c: 'sk-holo', ...xy(972, 302), w: 19.25, h: 15.1, d: -2 },
      { c: 'sk-car', x: 0, y: 16.67, s: 18, p: 1 },
      { c: 'sk-car', x: 0, y: 23.78, s: 26, d: -9 },
      { c: 'sk-car', x: 0, y: 30.67, s: 32, d: -20, p: 1 },
      ...leds()
    ]
  },
  // Elven twilight through carved arches: lanterns, fireflies, falls, valley mist, the real moon.
  silvan: {
    img: 'silvan.jpg', fx: 0.62,
    moon: { ...xy(941, 211), r: 3.125 },
    layers: [
      { c: 'sv-halo', ...xy(941, 211), w: 18.75, p: 1 },
      { c: 'sv-fall', ...xy(506, 406), w: 2.63, h: 18.2, s: 2.6, p: 1 },
      { c: 'sv-fall b', ...xy(509, 406), w: 2.25, h: 18.2, s: 1.8, d: -0.8 },
      { c: 'sv-spray', ...xy(482, 548), w: 5.63, h: 4.44, s: 3.2, p: 1 },
      { c: 'sv-fall', ...xy(1133, 426), w: 2, h: 10.9, s: 3, p: 1 },
      { c: 'sv-fall b', ...xy(1136, 426), w: 1.63, h: 10.9, s: 1.8, d: -1.1 },
      { c: 'sv-spray', ...xy(1116, 504), w: 4.13, h: 3.33, s: 3.2, d: -1.4, p: 1 },
      { c: 'sv-fall b', ...xy(678, 388), w: 1, h: 6, s: 1.8 },
      { c: 'sv-spray', ...xy(668, 428), w: 2.25, h: 1.78, s: 3.2, d: -0.6 },
      { c: 'sv-mist', ...xy(600, 500), w: 26.25, h: 10, s: 70, p: 1 },
      { c: 'sv-mist', ...xy(400, 540), w: 32.5, h: 12.2, s: 95, d: -40 },
      ...[[12, 396], [1439, 396], [1503, 333], [141, 218], [550, 214], [634, 158], [1229, 140], [1211, 252]].map(([x, y], i) => ({ c: 'sv-lamp', ...xy(x, y), w: 4.375, d: -(i * 0.7).toFixed(1), p: i % 2 })),
      ...scatter('sv-fly', 26, 17, 120, 1340, 280, 610).map((f, i) => ({ ...f, s: +(10 + (i * 7) % 10).toFixed(1), d: -((i * 1.9) % 14).toFixed(1) }))
    ]
  }
};

function leds() {
  const r = seeded(13);
  const cols = ['#5CFF9A', '#5CFF9A', '#6FD8FF', '#FFB45C'];
  const out = [];
  for (let i = 0; i < 40; i++) {
    const [x, y] = deck(i % 2 ? 1392 + r() * 30 : 1470 + r() * 34, 150 + r() * 480);
    out.push({ c: `sk-led k${Math.floor(r() * 4)}`, x, y, d: -(r() * 2).toFixed(2), s: +(0.6 + r() * 1.8).toFixed(2), p: i % 4 === 0 ? 1 : 0 });
  }
  return out;
}

// The moon tonight: 0 = new, 0.5 = full (synodic month from a known new moon).
export function moonPhase(date = new Date()) {
  const syn = 29.530588853;
  const epoch = Date.UTC(2000, 0, 6, 18, 14);
  const p = (((date.getTime() - epoch) / 864e5) % syn + syn) % syn / syn;
  return p;
}
// The shadow over a unit moon (radius 1, centered at 0,0) for a phase.
export function moonShadowPath(p) {
  const k = Math.cos(2 * Math.PI * p); // 1 new … -1 full
  const rx = Math.abs(k).toFixed(4);
  const waxing = p < 0.5;
  // Waxing: the dark side is the left; waning: the right.
  const side = waxing ? 0 : 1; // arc sweep for the outer half
  const bulge = waxing ? (k > 0 ? 0 : 1) : (k > 0 ? 1 : 0);
  return `M0 -1 A1 1 0 0 ${side} 0 1 A${rx} 1 0 0 ${bulge} 0 -1 Z`;
}
// Words for the phase, e.g. "The moon waxes · day six".
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five', 'twenty-six', 'twenty-seven', 'twenty-eight', 'twenty-nine'];
export function moonWords(date = new Date()) {
  const p = moonPhase(date);
  const day = Math.floor(p * 29.53);
  const state = p < 0.03 || p > 0.97 ? 'The moon is new' : Math.abs(p - 0.5) < 0.03 ? 'The moon is full' : p < 0.5 ? 'The moon waxes' : 'The moon wanes';
  return `${state} · day ${NUM[day] || day}`;
}

function xy(x, y) { const [a, b] = deck(x, y); return { x: a, y: b }; }

export const isScene = (theme) => !!SCENES[theme];

// Builds (or clears) the scene inside `host`. base = folder holding the paintings.
export function mountScene(host, theme, { base = '', phone = false } = {}) {
  if (!host) return;
  let el = host.querySelector(':scope > .scene');
  const sc = SCENES[theme];
  if (!sc) { if (el) el.remove(); return; }
  if (el && el.dataset.scene === theme) return;
  if (!el) {
    el = document.createElement('div');
    el.className = 'scene';
    el.setAttribute('aria-hidden', 'true');
    host.insertBefore(el, host.firstChild);
  }
  el.dataset.scene = theme;
  el.style.setProperty('--fx', String(phone ? sc.fx : 0.5));
  const layers = sc.layers.filter((l) => !phone || l.p).map((l) => {
    const st = [`left:${l.x}%`, `top:${l.y}%`];
    if (l.w != null) st.push(`width:${l.w}%`);
    if (l.h != null) st.push(`height:${l.h}%`);
    if (l.d != null) st.push(`--d:${l.d}s`);
    if (l.s != null) st.push(`--s:${l.s}s`);
    if (l.o != null) st.push(`opacity:${l.o}`);
    return `<i class="${l.c}" style="${st.join(';')}"></i>`;
  }).join('');
  const moon = sc.moon ? `<svg class="sc-moon" viewBox="-1 -1 2 2" style="left:${sc.moon.x}%;top:${sc.moon.y}%;width:${sc.moon.r * 2}%"><path d="${moonShadowPath(moonPhase())}"/></svg>` : '';
  el.innerHTML = `<div class="scene-stage sc-${theme}"><img class="scene-img" src="${base}${sc.img}" alt="" decoding="async">${moon}${layers}</div><div class="scene-shade"></div>`;
  // The moon's shadow follows the real phase: check it every few hours.
  clearInterval(el._moon);
  if (sc.moon) el._moon = setInterval(() => { const pth = el.querySelector('.sc-moon path'); if (pth) pth.setAttribute('d', moonShadowPath(moonPhase())); }, 3 * 3600e3);
}
