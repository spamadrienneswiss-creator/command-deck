// Draws the Wine Log home-screen icons (field-unit/wine/icons). Run once after changing the artwork:
//   node scripts/make-wine-icons.mjs
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../field-unit/wine/icons');
fs.mkdirSync(OUT, { recursive: true });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#1A1210"/>
<g opacity=".55">${Array.from({ length: 19 }, (_, i) => `<rect x="${i * 28}" y="0" width="26" height="512" fill="#221813"/>`).join('')}</g>
<circle cx="256" cy="246" r="190" fill="#5A2E4E" opacity=".35"/>
<path d="M186 128 H326 C330 214 306 262 256 270 C206 262 182 214 186 128 Z" fill="none" stroke="#C9A464" stroke-width="12" stroke-linejoin="round"/>
<path d="M194 190 H318 C312 236 292 258 256 262 C220 258 200 236 194 190 Z" fill="#7A2431"/>
<path d="M256 270 V372" stroke="#C9A464" stroke-width="12" stroke-linecap="round"/>
<path d="M206 380 H306" stroke="#C9A464" stroke-width="12" stroke-linecap="round"/>
<path d="M256 412 L266 422 L256 432 L246 422 Z" fill="#C9A464"/>
</svg>`;
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [180, 192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: path.join(OUT, `icon-${size}.png`), clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log('Wine Log icons →', OUT);
