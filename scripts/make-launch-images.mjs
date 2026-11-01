// Makes the iPhone launch images (what iOS shows for a split second while a Home Screen web app
// starts, before any page code runs). Without them iOS flashes a blank white screen.
// Run by hand only when the load-up screens change; the PNGs are committed.
//   node scripts/make-launch-images.mjs        (needs Playwright: npx playwright install chromium)
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'field-unit', 'icons', 'launch');
const { chromium } = await import(process.env.PLAYWRIGHT_PATH ? pathToFileURL(process.env.PLAYWRIGHT_PATH).href : 'playwright');

// [CSS width, CSS height, pixel ratio]: every iPhone screen size since the iPhone 8.
export const DEVICES = [
  [440, 956, 3], [430, 932, 3], [428, 926, 3], [414, 896, 3], [414, 896, 2], [402, 874, 3],
  [393, 852, 3], [390, 844, 3], [375, 812, 3], [375, 667, 2]
];

// The "Signal" load-up screens start on a plain black field (the boot log types onto it), so the
// launch image is that same black: nothing to line up, nothing that jumps when the page takes over.
const page = () => '<!doctype html><html><head><style>html, body { margin: 0; height: 100%; background: #0B0C0D; }</style></head><body></body></html>';

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const name of ['fieldunit', 'relay']) {
  for (const [w, h, dpr] of DEVICES) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    await p.setContent(page());
    await p.screenshot({ path: path.join(out, `${name}-${w * dpr}x${h * dpr}.png`) });
    await p.close();
  }
}
await browser.close();

// The <link> tags each page needs, printed for pasting into index.html / schedule.html / manifest.html.
for (const name of ['fieldunit', 'relay']) {
  console.log(`\n<!-- ${name} -->`);
  for (const [w, h, dpr] of DEVICES) {
    console.log(`<link rel="apple-touch-startup-image" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)" href="/icons/launch/${name}-${w * dpr}x${h * dpr}.png">`);
  }
}
