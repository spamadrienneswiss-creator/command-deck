// The Orb (v1.35): where its window goes. Pure functions, so they can be tested without Electron.
//
// One see-through window on the second screen, sitting at desktop level. Closed, it's a box
// the orb floats around in; open, it's big enough for the six screens that grow out of it.
// The orb's "home" is a point on a display; the window is placed around it, kept on screen.
const TU = require('./tower-util');

const SIZES = { closed: { w: 720, h: 520 }, open: { w: 1440, h: 900 } };
const PAD = 8; // keep the window this far inside the work area

// The screen the orb lives on: the one it was dragged to if that's still around; otherwise the
// biggest screen that isn't the main one (skipping short strips like the Xeneon Edge); otherwise
// the main one.
function pickDisplay(disp, displays, primaryId) {
  const list = displays || [];
  if (!list.length) return null;
  const main = list.find((d) => d.id === primaryId) || list[0];
  if (disp) return TU.resolveDisplay(disp, list, primaryId) || main;
  const others = list.filter((d) => d.id !== main.id && d.bounds.height >= 900);
  others.sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height);
  return others[0] || main;
}

// Home in screen pixels, from what was saved: { disp, fx, fy } = a spot on a display as fractions
// of its work area (so it survives a resolution change), null = the middle of the second screen.
function home(pos, displays, primaryId) {
  const d = pickDisplay(pos && pos.disp, displays, primaryId);
  if (!d) return { x: 360, y: 260, display: null };
  const wa = d.workArea;
  const fx = pos && Number.isFinite(pos.fx) ? Math.min(1, Math.max(0, pos.fx)) : 0.5;
  const fy = pos && Number.isFinite(pos.fy) ? Math.min(1, Math.max(0, pos.fy)) : 0.5;
  return { x: Math.round(wa.x + wa.width * fx), y: Math.round(wa.y + wa.height * fy), display: d };
}

// The window for a state: centred on home, shifted (never shrunk past the screen) to stay on it.
function box(center, state, wa) {
  const s = SIZES[state] || SIZES.closed;
  const w = Math.min(s.w, wa.width - PAD * 2);
  const h = Math.min(s.h, wa.height - PAD * 2);
  const x = Math.min(Math.max(Math.round(center.x - w / 2), wa.x + PAD), wa.x + wa.width - PAD - w);
  const y = Math.min(Math.max(Math.round(center.y - h / 2), wa.y + PAD), wa.y + wa.height - PAD - h);
  return { x, y, width: w, height: h };
}

// What to save after the orb is dragged so its home lands at `center`.
function dropped(center, displays, primaryId) {
  const list = displays || [];
  const d = list.find((x) => center.x >= x.bounds.x && center.x < x.bounds.x + x.bounds.width && center.y >= x.bounds.y && center.y < x.bounds.y + x.bounds.height)
    || list.find((x) => x.id === primaryId) || list[0];
  if (!d) return null;
  const wa = d.workArea;
  const r = (v) => Math.round(v * 1000) / 1000;
  return {
    disp: { id: d.id, x: d.bounds.x, y: d.bounds.y, w: d.bounds.width, h: d.bounds.height, main: d.id === primaryId },
    fx: r(Math.min(1, Math.max(0, (center.x - wa.x) / wa.width))),
    fy: r(Math.min(1, Math.max(0, (center.y - wa.y) / wa.height)))
  };
}

module.exports = { SIZES, PAD, pickDisplay, home, box, dropped };
