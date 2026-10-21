// Load-up screen controller. The #boot markup is already on the page (inline HTML, so it
// paints before scripts run); this just moves it along as the app really connects.
//
//   const boot = bootScreen();
//   boot.line(0, "SIGNAL · SAM'S DECK", 'OK');   // relay status lines, ticked in order
//   boot.progress(66);
//   boot.lock('Hi, Jordan.');                    // green, greeting, then fades out
//   boot.skip();                                 // errors, pairing: get out of the way now

const MIN_SHOW = 900;   // long enough to read as a moment, not a flicker
const STEP_GAP = 260;   // status lines tick one after another, never all at once
const HOLD = 850;       // how long the green lock stays up before fading

export function bootScreen() {
  const el = document.getElementById('boot');
  const t0 = performance.now();
  let chain = Promise.resolve();
  let shown = 0;
  let target = 0;
  let done = false;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (fn) => { chain = chain.then(fn).catch(() => {}); return chain; };
  const pctEl = el && el.querySelector('[data-pct]');
  const barEl = el && el.querySelector('.bt-bar i');

  function counter() {
    if (!pctEl) return;
    if (shown < target) shown = Math.min(target, shown + Math.max(1, Math.round((target - shown) / 6)));
    pctEl.textContent = `${String(shown).padStart(3, '0')}%`;
    if (shown < target) requestAnimationFrame(counter);
  }
  function setProgress(n) {
    target = Math.max(target, Math.min(100, Math.round(n)));
    if (barEl) barEl.style.width = `${target}%`;
    requestAnimationFrame(counter);
  }
  function hide() {
    if (!el || el.classList.contains('out')) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), 500);
  }

  if (!el) return { line() {}, progress() {}, lock() {}, skip() {}, sub() {} };
  return {
    sub(text) { const s = el.querySelector('[data-sub]'); if (s) s.textContent = text || ''; },
    line(i, text, result = 'OK') {
      if (done) return;
      q(async () => {
        const ln = el.querySelectorAll('.bt-line')[i];
        if (!ln) return;
        ln.querySelector('.t').textContent = text;
        ln.querySelector('.r').textContent = result;
        ln.classList.add('on');
        setProgress(((i + 1) / 3) * 90);
        await wait(STEP_GAP);
      });
    },
    progress(n) { if (!done) setProgress(n); },
    lock(greeting = '') {
      if (done) return;
      done = true;
      q(async () => {
        const left = MIN_SHOW - (performance.now() - t0);
        if (left > 0) await wait(left);
        setProgress(100);
        await wait(250);
        const hi = el.querySelector('[data-hi]');
        if (hi) hi.textContent = greeting;
        el.classList.add('locked');
        await wait(HOLD);
        hide();
      });
    },
    skip() { done = true; hide(); }
  };
}
