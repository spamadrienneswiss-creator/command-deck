// Comm Tower 1's dial: window placement, corner locking and shortcut rules (src/tower-util.js).
const assert = require('assert');
const TU = require('../src/tower-util');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; };

const main = { id: 1, bounds: { x: 0, y: 0, width: 2560, height: 1440 }, workArea: { x: 0, y: 0, width: 2560, height: 1392 } };
const second = { id: 7, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, workArea: { x: -1920, y: 0, width: 1920, height: 1032 } };
const edge = { id: 9, bounds: { x: 0, y: 1440, width: 2560, height: 720 }, workArea: { x: 0, y: 1440, width: 2560, height: 720 } };
const all = [main, second, edge];

// Nothing saved: bottom-right of the main display.
let a = TU.anchor(null, all, 1);
ok(a.pin === 'br' && a.x === 2560 - TU.EDGE && a.y === 1392 - TU.EDGE, 'default corner');

// Locked to the bottom-left of the second monitor.
const pos = TU.dropped({ x: -1920 + 110, y: 1032 - 80 }, second, 1);
ok(pos.pin === 'bl' && pos.disp.id === 7 && pos.disp.main === false, 'drop near a corner locks to it');
a = TU.anchor(pos, all, 1);
ok(a.x === -1920 + TU.EDGE && a.y === 1032 - TU.EDGE && a.display.id === 7, 'locked anchor');
// Windows renumbers the displays and moves the second one to the right: still that monitor.
const moved = { id: 22, bounds: { x: 2560, y: 0, width: 1920, height: 1080 }, workArea: { x: 2560, y: 0, width: 1920, height: 1032 } };
a = TU.anchor(pos, [main, moved, { ...edge, id: 23 }], 1);
ok(a.display.id === 22 && a.x === 2560 + TU.EDGE, 'follows the monitor after a reshuffle');
// That monitor unplugged: falls back to the main display, same corner.
a = TU.anchor(pos, [main], 1);
ok(a.display.id === 1 && a.pin === 'bl' && a.x === TU.EDGE, 'falls back to the main display');

// Dropped out in the open: stays where it was left.
const free = TU.dropped({ x: 900, y: 600 }, main, 1);
ok(free.cx === 900 && free.cy === 600 && !free.pin, 'free position');
ok(TU.anchor(free, all, 1).pin === null, 'free anchor is not locked');
ok(TU.anchor({ cx: 9000, cy: 9000 }, all, 1).pin === 'br', 'a position on a display that is gone goes home');
// Positions saved by the old button (v1.24 to v1.30).
a = TU.anchor({ l: 1000, b: 800 }, all, 1);
ok(a.x === 1064 && a.y === 736, 'old { l, b } converted');

// The fan opens right and up from a bottom-left corner, exactly filling the corner.
let p = TU.place(TU.anchor(pos, all, 1), 'open', 400, second.workArea);
ok(p.h === 'r' && p.v === 'u', 'opens right and up');
ok(p.bounds.x === -1920 && p.bounds.y + p.bounds.height === 1032 && p.bounds.width === TU.FAN, 'fan sits in the corner');
ok(p.hx === TU.EDGE && p.hy === TU.FAN - TU.EDGE, 'hub place inside the fan window');
// From the bottom-right it flips to the left; from the top it opens downward.
p = TU.place(TU.anchor(null, all, 1), 'open', 400, main.workArea);
ok(p.h === 'l' && p.v === 'u' && p.bounds.x + p.bounds.width === 2560, 'flips left at the right edge');
p = TU.place({ x: 96, y: 96 }, 'open', 400, main.workArea);
ok(p.h === 'r' && p.v === 'd' && p.bounds.y === 0, 'opens downward at the top');
// The hub stays put on screen in every state.
for (const st of ['closed', 'open', 'term']) {
  const c = { x: 700, y: 900 };
  const q = TU.place(c, st, 400, main.workArea);
  ok(q.bounds.x + q.hx === c.x && q.bounds.y + q.hy === c.y, `hub fixed in ${st}`);
}
ok(TU.place({ x: 700, y: 900 }, 'closed', 400, main.workArea).bounds.width === TU.CORE, 'closed is just the core');

// Shortcuts.
let s = TU.normalizeShortcut({ target: 'youtube.com' });
ok(s.ok && s.kind === 'web' && s.target === 'https://youtube.com' && s.name === 'youtube', 'bare domain becomes https');
s = TU.normalizeShortcut({ target: 'https://www.twitch.tv/directory', name: 'Twitch' });
ok(s.ok && s.kind === 'web' && s.name === 'Twitch', 'full address');
s = TU.normalizeShortcut({ target: '"C:\\Program Files (x86)\\Steam\\steam.exe"' });
ok(s.ok && s.kind === 'app' && s.name === 'steam' && !s.target.includes('"'), 'program path, quotes stripped');
s = TU.normalizeShortcut({ target: 'D:\\Projects\\Deck' });
ok(s.ok && s.kind === 'folder' && s.name === 'Deck', 'folder path');
for (const bad of ['', 'javascript:alert(1)', 'file:///etc/passwd', 'ms-settings:display', 'notepad.exe', 'just words']) ok(!TU.normalizeShortcut({ target: bad }).ok, `rejects ${bad || 'empty'}`);
ok(TU.cleanUrl('javascript:alert(1)') === '' && TU.cleanUrl('example.org/x') === 'https://example.org/x', 'cleanUrl');
const many = Array.from({ length: 9 }, (_v, i) => ({ id: `s${i}`, name: `N${i}`, target: `site${i}.com` }));
ok(TU.cleanShortcuts(many).length === TU.MAX_SHORTCUTS, 'at most five shortcuts');
ok(TU.cleanShortcuts([{ id: 'x', target: 'javascript:1' }, null, 'no']).length === 0, 'bad saved shortcuts dropped');

console.log(`dial-test: ${n} checks passed`);
