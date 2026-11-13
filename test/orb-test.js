// The Orb's placement (src/orb-util.js).
const assert = require('assert');
const OU = require('../src/orb-util');

const disp = (id, x, y, w, h, taskbar = 48) => ({ id, bounds: { x, y, width: w, height: h }, workArea: { x, y, width: w, height: h - taskbar } });
// Nick's desk: main on the left, the second screen on the right, the Xeneon Edge below.
const MAIN = disp(1, 0, 0, 2560, 1440);
const SECOND = disp(2, 2560, 0, 2560, 1440);
const EDGE = disp(3, 0, 1440, 2560, 720, 0);
const all = [MAIN, SECOND, EDGE];
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };

ok('lives on the second screen by default, not the main one or the Edge', () => {
  assert.strictEqual(OU.pickDisplay(null, all, 1).id, 2);
  assert.strictEqual(OU.pickDisplay(null, [MAIN, EDGE], 1).id, 1);
  assert.strictEqual(OU.pickDisplay(null, [MAIN], 1).id, 1);
});
ok('home is the middle of the second screen\'s work area', () => {
  const h = OU.home(null, all, 1);
  assert.deepStrictEqual([h.x, h.y], [2560 + 1280, 696]);
});
ok('a dragged home comes back on the same screen, even renumbered', () => {
  const pos = OU.dropped({ x: 2560 + 640, y: 1000 }, all, 1);
  assert.strictEqual(pos.disp.id, 2);
  const renumbered = [MAIN, { ...SECOND, id: 9 }, EDGE];
  const h = OU.home(pos, renumbered, 1);
  assert.strictEqual(h.display.id, 9);
  assert.ok(Math.abs(h.x - (2560 + 640)) <= 2 && Math.abs(h.y - 1000) <= 2);
});
ok('the window is centred on home, closed and open', () => {
  const h = OU.home(null, all, 1);
  const c = OU.box(h, 'closed', SECOND.workArea);
  assert.deepStrictEqual([c.x + c.width / 2, c.y + c.height / 2, c.width, c.height], [h.x, h.y, 720, 520]);
  const o = OU.box(h, 'open', SECOND.workArea);
  assert.deepStrictEqual([o.width, o.height], [1440, 900]);
});
ok('near an edge the window shifts to stay on screen', () => {
  const o = OU.box({ x: 2600, y: 1380 }, 'open', SECOND.workArea);
  assert.ok(o.x >= 2560 + OU.PAD && o.y + o.height <= 1392 - OU.PAD + 0.5);
});
ok('a small screen never gets a window bigger than it', () => {
  const tiny = disp(4, 0, 0, 1280, 720);
  const o = OU.box({ x: 640, y: 340 }, 'open', tiny.workArea);
  assert.ok(o.width <= 1280 - 2 * OU.PAD && o.height <= 672 - 2 * OU.PAD);
});
console.log(`orb: ${n} checks passed`);
