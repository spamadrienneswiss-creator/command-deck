const { app } = require('electron');
const fs = require('fs');
// Screenshots the deck in given themes. Usage (Linux, headless):
//   COMBOS='[{"name":"dusk","theme":"dusk"}]' SIZE=1280x800 xvfb-run -a npx electron --no-sandbox tools/deck-shots.js
// Each combo: { name, theme, frame?, trim?, alert?, extra?: 'settings', seed?: js run before reload, js?: js string(s) run before capture }.
// Images land in tools/out/deck/. Uses its own settings folder, so your real deck data is never touched.
const path = require('path');
const SP = path.join(__dirname, 'out');
app.setPath('userData', SP + '/deck-profile');
fs.mkdirSync(SP + '/deck', { recursive: true });
const combos = JSON.parse(process.env.COMBOS);
const [W, H] = (process.env.SIZE || '1280x800').split('x').map(Number);
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error' || ev.level === 3) console.log('[renderer err]', ev.message); });
  setTimeout(async () => {
    const js = (c) => win.webContents.executeJavaScript(c);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      win.setSize(W, H); await wait(4000);
      for (const c of combos) {
        await js(`(async()=>{const d=await deck.load(); const s={...d.settings, theme:'${c.theme}', font:'auto', frame:'${c.frame || 'dark'}', trim:'${c.trim || 'none'}', motion:'full', ink:'theme', windowMode:'top'}; await deck.save('settings', s);})()`).catch(() => {});
        if (c.seed) await js(c.seed).catch((e) => console.log('seed err', e.message));
        win.webContents.reloadIgnoringCache();
        await wait(6000);
        console.log('THEME', c.name, await js(`deck.load().then(d=>JSON.stringify({t:d.settings&&d.settings.theme, body:document.body.dataset.theme, keys:Object.keys(d)}))`));
        if (c.alert) await js(`(()=>{const el=document.querySelector('#alertStrip'); el.dataset.type='${c.alert}'; el.innerHTML='<span class="al-dot"></span><div class="al-text"><div class="al-title">PAST DUE · PAY ELECTRIC BILL</div><div class="al-sub">Was due at 4:30 PM</div></div><div class="al-btns"><button type="button" class="al-btn">SNOOZE 10 MIN</button><button type="button" class="al-btn">MARK DONE</button><button type="button" class="al-btn ghost">DISMISS</button></div>'; el.hidden=false;})()`);
        if (c.extra === 'settings') { await js(`document.querySelector('#btnSettings').click()`); await wait(400); await js(`[...document.querySelectorAll('.modal [role=tab], .modal .tab, .modal button')].find(t=>/^\\s*LOOK|APPEARANCE|THEME/i.test(t.textContent))?.click()`); }
        if (c.js) { for (const step of [].concat(c.js)) { await js(step).catch((e) => console.log('js err', e.message)); await wait(500); } }
        await wait(600);
        fs.writeFileSync(`${SP}/deck/${c.name}.png`, (await win.webContents.capturePage()).toPNG());
      }
    } catch (e) { console.log('SMOKE ERR', e.message); }
    app.exit(0);
  }, 7000);
});
require(path.join(__dirname, '..', 'main.js'));
