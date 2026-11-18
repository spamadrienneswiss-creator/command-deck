// The deck's link rules: Browser button address and shortcut keys (src/links.js).
const assert = require('assert');
const TU = require('../src/links');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; };

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

console.log(`links-test: ${n} checks passed`);
