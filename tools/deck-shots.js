const { app } = require('electron');
const fs = require('fs');
// Screenshots the deck in given themes. Usage (Linux, headless):
//   COMBOS='[{"name":"dusk","theme":"dusk"}]' SIZE=1280x800 xvfb-run -a npx electron --no-sandbox tools/deck-shots.js
// Each combo: { name, theme, towerType?: [lines] (opens Comm Tower 1's pop-up, types each line, captures <name>-tower.png), wait? (ms after reload; the Signal load-up takes ~9 s on FULL), frame?, trim?, alert?, extra?: 'settings', seed?: js run before reload, js?: js string(s) run before capture }.
// Images land in tools/out/deck/. Uses its own settings folder, so your real deck data is never touched.
const path = require('path');
const SP = path.join(__dirname, 'out');
app.setPath('userData', SP + '/deck-profile');
fs.mkdirSync(SP + '/deck', { recursive: true });
const combos = JSON.parse(process.env.COMBOS);
const SEED = process.env.SEED || ''; // optional js run once before the first combo (sample data)
const [W, H] = (process.env.SIZE || '1280x800').split('x').map(Number);
let towerWin = null;
app.on('browser-window-created', (_e, win) => {
  // Comm Tower 1 is its own small window: keep a handle for its pictures, don't drive it.
  if (win.getTitle() === 'Comm Tower 1') { towerWin = win; win.webContents.on('console-message', (ev) => { if (ev.level === 'error' || ev.level === 3) console.log('[tower err]', ev.message); }); return; }
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error' || ev.level === 3) console.log('[renderer err]', ev.message); });
  setTimeout(async () => {
    // Gives up after 10 s, so a frozen page shows up as HUNG instead of stalling the run.
    const js = (c) => Promise.race([win.webContents.executeJavaScript(c), new Promise((_, no) => setTimeout(() => no(new Error('HUNG (no answer in 10 s)')), 10000))]);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      win.setSize(W, H); await wait(4000);
      if (SEED) await js(SEED).catch((e) => console.log('SEED err', e.message));
      for (const c of combos) {
        await js(`(async()=>{const d=await deck.load(); const s={...d.settings, theme:'${c.theme}', font:'auto', frame:'${c.frame || 'dark'}', trim:'${c.trim || 'none'}', motion:'full', ink:'theme', windowMode:'top'}; await deck.save('settings', s);})()`).catch(() => {});
        if (c.seed) await js(c.seed).catch((e) => console.log('seed err', e.message));
        win.webContents.reloadIgnoringCache();
        await wait(c.wait || 6000);
        console.log('THEME', c.name, await js(`deck.load().then(d=>JSON.stringify({t:d.settings&&d.settings.theme, body:document.body.dataset.theme, keys:Object.keys(d)}))`));
        if (c.alert) await js(`(()=>{const el=document.querySelector('#alertStrip'); el.dataset.type='${c.alert}'; el.innerHTML='<span class="al-dot"></span><div class="al-text"><div class="al-title">PAST DUE · PAY ELECTRIC BILL</div><div class="al-sub">Was due at 4:30 PM</div></div><div class="al-btns"><button type="button" class="al-btn">SNOOZE 10 MIN</button><button type="button" class="al-btn">MARK DONE</button><button type="button" class="al-btn ghost">DISMISS</button></div>'; el.hidden=false;})()`);
        if (c.extra === 'settings') { await js(`document.querySelector('#btnSettings').click()`); await wait(400); await js(`[...document.querySelectorAll('.modal [role=tab], .modal .tab, .modal button')].find(t=>/^\\s*LOOK|APPEARANCE|THEME/i.test(t.textContent))?.click()`); }
        if (c.js) { for (const step of [].concat(c.js)) { console.log('STEP', c.name, String(await js(step).catch((e) => 'js err ' + e.message)).slice(0, 300)); await wait(500);  } }
        await wait(600);
        fs.writeFileSync(`${SP}/deck/${c.name}.png`, (await win.webContents.capturePage()).toPNG());
        if (c.towerType && towerWin) {
          // Open Comm Tower 1's pop-up (a real click on the button), then type into it.
          await towerWin.webContents.executeJavaScript(`(()=>{const c=document.querySelector('#chip');c.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:1,screenX:5,screenY:5}));c.dispatchEvent(new PointerEvent('pointerup',{button:0,pointerId:1,screenX:5,screenY:5}));return 1})()`).catch((e) => console.log('open err', e.message));
          await wait(800);
          for (let i = 0; i < c.towerType.length; i++) {
            await js(`window.__towerSend(${JSON.stringify(c.towerType[i])}).then(()=>1)`).catch((e) => console.log('type err', e.message));
            await wait(1500);
          }
          console.log('TOWER', c.name, JSON.stringify(towerWin.getBounds()), await towerWin.webContents.executeJavaScript(`document.querySelector('#log').innerText.replace(/\\n/g,' | ')`).catch((e) => e.message));
          fs.writeFileSync(`${SP}/deck/${c.name}-tower.png`, (await towerWin.webContents.capturePage()).toPNG());
        }
      }
    } catch (e) { console.log('SMOKE ERR', e.message); }
    app.exit(0);
  }, 7000);
});
require(path.join(__dirname, '..', 'main.js'));
