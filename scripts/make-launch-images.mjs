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

const font = pathToFileURL(path.join(root, 'node_modules/@fontsource/chakra-petch/files/chakra-petch-latin-500-normal.woff2')).href;
// Neutral colors so it hands over cleanly to whichever theme the load-up screen paints in.
// Laid out to line up with the load-up screens (boot.css), so the hand-off doesn't jump.
const page = (word, rings) => `<!doctype html><html><head><style>
@font-face { font-family: CP; src: url('${font}'); font-weight: 500; }
html, body { margin: 0; height: 100%; background: #0B0C11; }
body { display: flex; flex-direction: column; align-items: center; justify-content: center; font: 500 22px/1 CP, sans-serif; letter-spacing: .32em; color: #F4EFE9; }
.w { padding-left: .32em; }
.r { position: relative; width: 240px; height: 240px; margin: 48px 0 40px; }
.r i { position: absolute; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(236,231,225,.13); }
</style></head><body>${rings
    ? `<div class="w">${word}</div><div class="r"><i style="inset:0"></i><i style="inset:40px"></i><i style="inset:80px"></i></div><div style="height:90px"></div>`
    : `<div style="height:130px"></div><div class="w">${word}</div><div style="height:268px"></div>`}</body></html>`;

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const [name, word, rings] of [['fieldunit', 'FIELD UNIT', true], ['relay', 'DECK RELAY', false]]) {
  for (const [w, h, dpr] of DEVICES) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    await p.setContent(page(word, rings));
    await p.evaluate(() => document.fonts.ready);
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
