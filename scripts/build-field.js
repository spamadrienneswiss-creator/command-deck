// Prepares the Field Unit web app for hosting: copies the shared modules it
// needs into field-unit/lib. Run by `npm run deploy` (and `npm run build:field`).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const lib = path.join(root, 'field-unit', 'lib');
fs.mkdirSync(lib, { recursive: true });
const copies = [
  ['shared/core.js', 'core.js'],
  ['shared/sync.js', 'sync.js'],
  ['shared/manifest.js', 'manifest.js'],
  ['shared/roster.js', 'roster.js'],
  ['renderer/util.js', 'util.js']
];
for (const [from, to] of copies) {
  fs.copyFileSync(path.join(root, from), path.join(lib, to));
  console.log(`  ${from} → field-unit/lib/${to}`);
}
// Text reader for Field Scan (Tesseract, runs on the phone). Hosted alongside
// the app so the first scan doesn't depend on any outside website.
// Field Scan is switched off for now (FIELD_SCAN in field-unit/app.js), so the
// 7 MB reader isn't published. Set this back to true together with that flag.
const FIELD_SCAN = false;
const ocr = path.join(root, 'field-unit', 'vendor', 'ocr');
if (!FIELD_SCAN) fs.rmSync(ocr, { recursive: true, force: true });
if (FIELD_SCAN) {
fs.mkdirSync(path.join(ocr, 'lang'), { recursive: true });
const tjs = path.dirname(require.resolve('tesseract.js/package.json'));
const core = path.dirname(require.resolve('tesseract.js-core/package.json', { paths: [tjs] }));
const data = path.dirname(require.resolve('@tesseract.js-data/eng/package.json'));
const ocrFiles = [
  [path.join(tjs, 'dist', 'tesseract.min.js'), 'tesseract.min.js'],
  [path.join(tjs, 'dist', 'worker.min.js'), 'worker.min.js'],
  [path.join(core, 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [path.join(core, 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [path.join(core, 'tesseract-core-relaxedsimd-lstm.wasm.js'), 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  [path.join(data, '4.0.0_best_int', 'eng.traineddata.gz'), path.join('lang', 'eng.traineddata.gz')]
];
for (const [from, to] of ocrFiles) fs.copyFileSync(from, path.join(ocr, to));
console.log('  text reader → field-unit/vendor/ocr');
}
// Typefaces for the themes and the Typeface setting, served with the app.
const fontDir = path.join(root, 'field-unit', 'fonts');
fs.mkdirSync(fontDir, { recursive: true });
const FONT_FILES = { michroma: [400], 'space-mono': [400, 700], 'exo-2': [200, 300, 400, 500, 600], 'b612-mono': [400, 700], vt323: [400], orbitron: [400, 500, 600, 700], oxanium: [300, 400, 500, 600], rajdhani: [400, 500, 600], 'major-mono-display': [400], quantico: [400, 700], 'azeret-mono': [400, 500, 600], tektur: [400, 500, 600, 700], 'geist-mono': [300, 400, 500, 600] };
for (const [fam, weights] of Object.entries(FONT_FILES)) {
  const dir = path.join(path.dirname(require.resolve(`@fontsource/${fam}/package.json`)), 'files');
  for (const w of weights) fs.copyFileSync(path.join(dir, `${fam}-latin-${w}-normal.woff2`), path.join(fontDir, `${fam}-${w}.woff2`));
}
console.log('  typefaces → field-unit/fonts');
const version = require(path.join(root, 'package.json')).version;
fs.writeFileSync(path.join(root, 'field-unit', 'version.json'), JSON.stringify({ version, built: new Date().toISOString() }) + '\n');
// Every release gets its own offline cache, so phones drop the old files on the next open.
const swPath = path.join(root, 'field-unit', 'sw.js');
fs.writeFileSync(swPath, fs.readFileSync(swPath, 'utf8').replace(/const CACHE = '[^']*';/, `const CACHE = 'field-unit-v${version}';`));
console.log(`Field Unit ready (v${version}).`);
