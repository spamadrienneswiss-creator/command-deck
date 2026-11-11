// Comm Tower 1's dial (v1.31): where its window goes, and what counts as a shortcut.
// Pure functions, so they can be tested without Electron.

// The window is only ever as big as what shows. The hub (the core you click) keeps
// its place on screen while the window grows and shrinks around it.
const CORE = 128; // closed: a square with the hub in the middle
const FAN = 460; // open: the fan of keys; the hub sits EDGE from the two near sides
const EDGE = 96; // how far the hub sits from a screen corner it's locked to
const TERM_W = 396; // the pop-up terminal (360) plus room for its glow
const POP_PAD = 18;
const POP_GAP = 6;
const SNAP = 150; // drop the dial this close to a corner and it locks there
const MAX_SHORTCUTS = 5;

// Size of the window in each state, and how far the hub is from the near edges.
function stateBox(state, popH = 400) {
  if (state === 'open') return { w: FAN, h: FAN, nx: EDGE, ny: EDGE };
  if (state === 'term') return { w: TERM_W, h: Math.round(popH) + POP_PAD + POP_GAP + CORE, nx: CORE / 2, ny: CORE / 2 };
  return { w: CORE, h: CORE, nx: CORE / 2, ny: CORE / 2 };
}

// Which way a state opens from the hub: right and up by preference; the other way when
// that would run off the screen (wa = the display's work area).
function dirs(center, box, wa) {
  const farX = box.w - box.nx;
  const farY = box.h - box.ny;
  const roomR = wa.x + wa.width - center.x;
  const roomL = center.x - wa.x;
  const roomU = center.y - wa.y;
  const roomD = wa.y + wa.height - center.y;
  const h = roomR >= farX ? 'r' : roomL >= farX ? 'l' : roomR >= roomL ? 'r' : 'l';
  const v = roomU >= farY ? 'u' : roomD >= farY ? 'd' : roomU >= roomD ? 'u' : 'd';
  return { h, v };
}

// Window bounds for a state, plus where the hub lands inside the window.
function place(center, state, popH, wa) {
  const box = stateBox(state, popH);
  const { h, v } = state === 'closed' ? { h: 'r', v: 'u' } : dirs(center, box, wa);
  const farX = box.w - box.nx;
  const farY = box.h - box.ny;
  const x = h === 'r' ? center.x - box.nx : center.x - farX;
  const y = v === 'u' ? center.y - farY : center.y - box.ny;
  return {
    bounds: { x: Math.round(x), y: Math.round(y), width: box.w, height: box.h },
    hx: h === 'r' ? box.nx : farX,
    hy: v === 'u' ? farY : box.ny,
    h, v, state
  };
}

// Where the hub sits when locked to each corner of a work area.
function corners(wa) {
  return {
    tl: { x: wa.x + EDGE, y: wa.y + EDGE },
    tr: { x: wa.x + wa.width - EDGE, y: wa.y + EDGE },
    bl: { x: wa.x + EDGE, y: wa.y + wa.height - EDGE },
    br: { x: wa.x + wa.width - EDGE, y: wa.y + wa.height - EDGE }
  };
}

// The corner a dropped dial should lock to, or null when it's out in the open.
function snapCorner(center, wa) {
  let best = null;
  for (const [name, c] of Object.entries(corners(wa))) {
    const d = Math.hypot(center.x - c.x, center.y - c.y);
    if (d <= SNAP && (!best || d < best.d)) best = { name, d };
  }
  return best ? best.name : null;
}

// Find the display a lock was made on. Windows can renumber and reorder displays, so:
// the same id first, then the same place and size, then the same size on a display
// that isn't the main one, then the main one.
function resolveDisplay(disp, displays, primaryId) {
  const list = displays || [];
  const main = list.find((d) => d.id === primaryId) || list[0] || null;
  if (!disp) return main;
  const size = (d) => d.bounds.width === disp.w && d.bounds.height === disp.h;
  return list.find((d) => d.id === disp.id)
    || list.find((d) => size(d) && d.bounds.x === disp.x && d.bounds.y === disp.y)
    || (disp.main ? null : list.find((d) => size(d) && d.id !== primaryId))
    || main;
}

// The hub's centre from what was saved. Shapes over the years:
//   { pin: 'bl', disp: { id, x, y, w, h, main } }   locked to a corner (v1.31)
//   { cx, cy }                                      left out in the open (v1.31)
//   { l, b } / { r, b }                             the old button's edges (v1.24 to v1.30)
//   null                                            bottom-right of the main display
function anchor(pos, displays, primaryId) {
  const list = displays || [];
  const main = list.find((d) => d.id === primaryId) || list[0];
  const fallback = () => ({ ...corners(main.workArea).br, pin: 'br', display: main });
  if (!main) return { x: EDGE, y: EDGE, pin: null, display: null };
  if (!pos) return fallback();
  if (pos.pin && corners(main.workArea)[pos.pin]) {
    const d = resolveDisplay(pos.disp, list, primaryId) || main;
    return { ...corners(d.workArea)[pos.pin], pin: pos.pin, display: d };
  }
  let c = null;
  if (Number.isFinite(pos.cx) && Number.isFinite(pos.cy)) c = { x: pos.cx, y: pos.cy };
  else if (Number.isFinite(pos.l) && Number.isFinite(pos.b)) c = { x: pos.l + CORE / 2, y: pos.b - CORE / 2 };
  else if (Number.isFinite(pos.r) && Number.isFinite(pos.b)) c = { x: pos.r - CORE / 2, y: pos.b - CORE / 2 };
  if (!c) return fallback();
  const d = list.find((x) => c.x >= x.bounds.x && c.x < x.bounds.x + x.bounds.width && c.y >= x.bounds.y && c.y < x.bounds.y + x.bounds.height);
  if (!d) return fallback(); // that display is gone
  return { ...c, pin: null, display: d };
}

// What to save after a drag ends with the hub at `center` on display `d`.
function dropped(center, d, primaryId) {
  const pin = snapCorner(center, d.workArea);
  if (!pin) return { cx: Math.round(center.x), cy: Math.round(center.y) };
  return { pin, disp: { id: d.id, x: d.bounds.x, y: d.bounds.y, w: d.bounds.width, h: d.bounds.height, main: d.id === primaryId } };
}

// ---- shortcuts: a website, a program or file, or a folder
const WEB = /^https?:\/\/[^\s]+$/i;
const DOMAIN = /^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/[^\s]*)?$/i;
const ABS = /^([a-zA-Z]:[\\/]|\\\\|\/)/;
const RUNNABLE = /\.(exe|lnk|bat|cmd|msi|url|appref-ms)$/i;

function cleanUrl(text) {
  const t = String(text || '').trim();
  if (WEB.test(t)) return t;
  if (DOMAIN.test(t) && !RUNNABLE.test(t)) return `https://${t}`;
  return '';
}

function normalizeShortcut(input) {
  let target = String((input && input.target) || '').trim().replace(/^"(.*)"$/, '$1').trim();
  let name = String((input && input.name) || '').trim();
  if (!target) return { ok: false, error: 'Paste a website address, or pick a program or folder.' };
  if (target.length > 400) return { ok: false, error: 'That address is too long.' };
  let kind = '';
  const url = cleanUrl(target);
  if (url) { kind = 'web'; target = url; }
  else if (/^[a-z][a-z0-9+.-]*:(?![\\/])/i.test(target) || /^[a-z][a-z0-9+.-]{1,}:\/\//i.test(target)) return { ok: false, error: 'Only web addresses (http or https), programs and folders can be shortcuts.' };
  else if (ABS.test(target)) kind = /\.[a-z0-9-]{1,10}$/i.test(target) ? 'app' : 'folder';
  else return { ok: false, error: 'Use a full web address, or pick the program or folder with the buttons.' };
  if (!name) {
    if (kind === 'web') { try { name = new URL(target).hostname.replace(/^www\./, '').split('.')[0]; } catch { name = 'Site'; } }
    else name = target.replace(/[\\/]+$/, '').split(/[\\/]/).pop().replace(/\.[a-z0-9-]{1,10}$/i, '') || 'Shortcut';
  }
  return { ok: true, kind, target, name: name.slice(0, 18) };
}

function cleanShortcuts(list) {
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    if (!s || typeof s !== 'object') continue;
    const n = normalizeShortcut(s);
    if (n.ok && s.id && !out.some((o) => o.id === s.id)) out.push({ id: String(s.id), name: n.name, kind: n.kind, target: n.target });
    if (out.length >= MAX_SHORTCUTS) break;
  }
  return out;
}

const SKINS = ['eclipse', 'sentinel', 'prism', 'halo', 'theme'];

module.exports = { CORE, FAN, EDGE, TERM_W, SNAP, MAX_SHORTCUTS, SKINS, stateBox, dirs, place, corners, snapCorner, resolveDisplay, anchor, dropped, cleanUrl, normalizeShortcut, cleanShortcuts };
