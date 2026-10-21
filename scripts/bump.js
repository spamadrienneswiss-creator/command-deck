// Sets the version everywhere it appears:  npm run bump -- 1.11.1
// (package.json, the console's version label, Field Unit's version label).
// Then commit and push to main; the release workflow sees the new version and does the rest.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const v = String(process.argv[2] || '').replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(v)) { console.error('Usage: npm run bump -- 1.2.3'); process.exit(1); }
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = v;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
for (const f of ['renderer/app.js', 'field-unit/app.js']) {
  const p = path.join(root, f);
  const src = fs.readFileSync(p, 'utf8');
  const next = src.replace(/const VERSION = 'v[\d.]+';/, `const VERSION = 'v${v}';`);
  if (next === src && !src.includes(`const VERSION = 'v${v}';`)) { console.error(`No VERSION line in ${f}`); process.exit(1); }
  fs.writeFileSync(p, next);
}
console.log(`Version set to ${v}. Commit and push to main to release it.`);
