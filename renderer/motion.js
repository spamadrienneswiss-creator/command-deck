// Keeps Command Deck light on the CPU.
//
// Every looping animation (waveform, scanline, blinking lamps) makes the whole
// see-through window redraw, so they're stepped at 10 frames a second instead of
// 60 (the painted themes' moving layers get 20, so ships glide). They look the same at that pace. While the computer is talking or listening
// they run at full speed, and while nobody is at the PC (idle 5 minutes, locked,
// or the console hidden) they freeze until someone's back.
const FPS = 20; // painted scenes step at 20; everything else every other tick (10)
let away = false;
let timer = null;
let tick = 0;
const inScene = (a) => !!(a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.scene'));

function looping(a) {
  const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
  return !!t && t.iterations === Infinity;
}

function voiceActive() {
  const v = document.body.dataset.voice;
  return !!v && v !== 'idle';
}

export function step() {
  const now = document.timeline && document.timeline.currentTime != null ? document.timeline.currentTime : performance.now();
  const smooth = !away && voiceActive();
  tick++;
  for (const a of document.getAnimations()) {
    if (!looping(a)) continue;
    if (!smooth && !away && tick % 2 && !inScene(a)) continue;
    if (smooth) {
      if (a.playState === 'paused') a.play();
      continue;
    }
    if (a.playState !== 'paused') a.pause();
    if (!away) a.currentTime = now;
  }
}

export function setAway(v) {
  away = !!v;
  document.body.classList.toggle('away', away);
  step();
}

export function isAway() { return away; }

export function start() {
  clearInterval(timer);
  timer = setInterval(step, Math.round(1000 / FPS));
  step();
}
