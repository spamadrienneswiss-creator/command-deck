// The installer only packs the files listed in package.json "build.files". Every
// shared/ file the deck's pages load must be listed, or the deck won't start
// (v1.20.0 shipped without shared/scenes.js and the deck came up broken).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const files = require(path.join(root, 'package.json')).build.files;
const used = new Set();
for (const f of fs.readdirSync(path.join(root, 'renderer'))) {
  if (!/\.(js|html|css)$/.test(f)) continue;
  const text = fs.readFileSync(path.join(root, 'renderer', f), 'utf8');
  for (const m of text.matchAll(/\.\.\/shared\/([\w.-]+)/g)) used.add(`shared/${m[1]}`);
}
const missing = [...used].filter((f) => !files.includes(f));
if (missing.length) { console.error('Not packed into the installer:', missing.join(', ')); process.exit(1); }
console.log(`packaging: ${used.size} shared files used by the deck, all packed`);
