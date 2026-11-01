// Load-up screen controller ("Signal"). The #boot markup is already on the page (inline HTML,
// so the boot log paints before scripts run); this ticks the log through the page's real
// connection steps, then plays alignment → radar → SIGNAL LOCKED and fades out.
//
//   const boot = bootScreen();
//   boot.line(0, 'Relay uplink', 'ONLINE');        // a real step finished: one log line
//   boot.lock('Welcome, Jordan.', "SAM'S SCHEDULE · READ + ADD");
//   boot.skip();                                   // errors, pairing: get out of the way now
//
// The page sets its wording on #boot: data-chip, data-align, data-scan, data-rows (comma list),
// data-handoff (the last log line). Reduced motion goes straight from the log to the lock.

const MIN_SHOW = 900;   // long enough to read as a moment, not a flicker
const STEP_GAP = 170;   // log lines tick one after another, never all at once
const ALIGN = 900;      // alignment card
const RADAR = 950;      // radar sweep
const HOLD = 1100;      // SIGNAL LOCKED + greeting, before fading
const PIX = ['1010101', '0111110', '1010101'];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function bootScreen() {
  const el = document.getElementById('boot');
  if (!el) return { line() {}, progress() {}, lock() {}, skip() {}, sub() {} };
  const t0 = performance.now();
  let chain = Promise.resolve();
  let done = false;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (fn) => { chain = chain.then(fn).catch(() => {}); return chain; };
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const linesEl = el.querySelector('[data-lines]');
  const stamp = () => `[${((performance.now() - t0) / 1000).toFixed(3)}]`;
  const stage = (n) => { el.classList.remove('s1', 's2', 's3', 's4'); el.classList.add(`s${n}`); };
  const d = el.dataset;
  stage(1);

  function hide() {
    if (el.classList.contains('out')) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), 500);
  }

  // The later stages are built here (only the log has to paint before scripts run).
  function build() {
    const rows = String(d.rows || 'LINK,RELAY').split(',').map((r) => r.trim()).filter(Boolean);
    const card = el.querySelector('.sb-align');
    if (card) card.innerHTML = `<div class="sb-card"><div class="sb-ch"><span class="sb-chip">${esc(d.chip || 'CMD·DECK')}</span><span>${esc(d.align || 'ALIGNING LINK')}<span class="sb-dots"></span></span></div>
      <div class="sb-rows">${rows.map((r, i) => `<div class="sb-row" style="margin:0 ${i * 5}px;animation-delay:${(i * 0.08).toFixed(2)}s"><b class="l" style="--to:${(22 + i * 2.6).toFixed(1)}%;animation-delay:${(0.15 + i * 0.08).toFixed(2)}s"></b><b class="r" style="--to:${(22 + i * 2.6).toFixed(1)}%;animation-delay:${(0.15 + i * 0.08).toFixed(2)}s"></b><span class="l">+ ${esc(r)}</span><span class="r">${esc(r)} +</span></div>`).join('')}</div></div>`;
    const radar = el.querySelector('.sb-radar');
    if (radar) radar.innerHTML = `<div class="sb-scan">${esc(d.scan || 'SCANNING')}<span class="sb-dots"></span></div>
      <div class="sb-rad" aria-hidden="true">
        ${[55, 105, 160, 220].map((r, i) => `<i class="sb-arc" style="width:${r * 2}px;height:${r}px;box-shadow:inset 0 0 0 1.5px rgba(var(--g-rgb),${(0.95 - i * 0.18).toFixed(2)});animation-delay:${(0.3 + i * 0.1).toFixed(2)}s"></i>`).join('')}
        <i class="sb-mast"></i><i class="sb-ray" style="--r:-50deg"></i><i class="sb-ray" style="--r:50deg"></i>
        <i class="sb-base"></i><span class="sb-ticks"><i></i><i></i><i></i><i></i><i></i></span><i class="sb-blip"></i>
      </div>`;
    const lock = el.querySelector('.sb-lock');
    if (lock) lock.innerHTML = `<div class="sb-px" aria-hidden="true">${PIX.join('').split('').map((c) => `<i class="${c === '1' ? 'on' : ''}"></i>`).join('')}</div>
      <div class="sb-locked">SIGNAL LOCKED</div><div class="sb-hi" data-hi></div><div class="sb-lsub" data-lsub></div>`;
  }
  build();

  return {
    sub(text) { const s = el.querySelector('[data-sub]'); if (s) s.textContent = text || ''; },
    /** One finished step in the log: "[0.412] Relay uplink ... ONLINE". */
    line(_i, text, result = 'OK') {
      if (done || !linesEl) return;
      const at = stamp();
      q(async () => {
        const div = document.createElement('div');
        div.className = 'sb-ln';
        div.innerHTML = `${at} ${esc(text)} ... <span class="ok">${esc(result)}</span>`;
        linesEl.appendChild(div);
        await wait(STEP_GAP);
      });
    },
    progress() { /* the log shows progress now; kept so callers don't change */ },
    lock(greeting = '', sub = '') {
      if (done) return;
      done = true;
      q(async () => {
        const left = MIN_SHOW - (performance.now() - t0);
        if (left > 0) await wait(left);
        if (linesEl) {
          const last = document.createElement('div');
          last.className = 'sb-ln cur';
          last.textContent = `${stamp()} ${d.handoff || 'Opening'}`;
          linesEl.appendChild(last);
        }
        await wait(380);
        if (!reduced) {
          stage(2); await wait(ALIGN);
          stage(3); await wait(RADAR);
        }
        const hi = el.querySelector('[data-hi]');
        if (hi) hi.textContent = greeting;
        const ls = el.querySelector('[data-lsub]');
        if (ls) ls.textContent = sub;
        stage(4);
        await wait(HOLD);
        hide();
      });
    },
    skip() { done = true; hide(); }
  };
}
