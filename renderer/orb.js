// The Orb (v1.35): Command Deck as a ball of living light on the second screen.
//
// Closed, it drifts around its home: hundreds of swirling trails of light round a white-hot
// heart, tendrils that reach out and pull back, sparks wandering about. It leans toward the
// pointer. Click it and it blooms: the window grows (main.js) and six glass screens come out
// of it on veins of light. Click a screen to bring it close, empty space to send it back,
// the orb to fold everything away. Its colour and pace follow the deck: amber when something
// is due within the hour, a red heartbeat when something is overdue, churning while Comms
// thinks, a red heart while a meeting records. Drag the closed orb to move its home.
//
// Positions are window pixels. main.js answers every layout request with the window's place
// on screen and the home point (orb:layout), and the page shifts what's drawn so nothing jumps.
(() => {
  'use strict';
  const O = window.orb;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------ the light itself
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const PALS = {
    rest: { core: [255, 255, 255], a: [196, 246, 255], b: [56, 198, 232], c: [157, 140, 255], halo: [40, 150, 225], tint: [196, 246, 255] },
    thinking: { core: [255, 255, 255], a: [222, 232, 255], b: [120, 168, 255], c: [205, 186, 255], halo: [110, 110, 245], tint: [222, 232, 255] },
    soon: { core: [255, 251, 238], a: [255, 228, 178], b: [255, 176, 86], c: [255, 128, 98], halo: [235, 130, 45], tint: [255, 228, 178] },
    late: { core: [255, 242, 244], a: [255, 196, 204], b: [255, 78, 100], c: [255, 140, 168], halo: [225, 35, 70], tint: [255, 196, 204] },
    rec: { core: [255, 236, 238], a: [196, 246, 255], b: [56, 198, 232], c: [157, 140, 255], halo: [205, 55, 90], tint: [255, 84, 104] }
  };
  const SPEED = { rest: 1, thinking: 2.4, soon: 1.1, late: 1.15, rec: 1 };
  const clonePal = (p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.slice()]));

  const spawn = (initial) => {
    const max = 1.4 + Math.random() * 3.2;
    return { a: Math.random() * TAU, r: Math.pow(Math.random(), 0.75) * 0.9, w: (Math.random() < 0.85 ? 1 : -1) * (0.3 + Math.random() * 0.7),
      sd: Math.random() * TAU, life: initial ? Math.random() * max : 0, max, px: null, py: null, wd: Math.random() };
  };
  const ob = {
    x: 360, y: 260, vx: 0, vy: 0, tx: 360, ty: 260, R: 92, Rt: 92, wander: 190, spd: 1, spdT: 1, mood: 'rest',
    pal: clonePal(PALS.rest), seed: Math.random() * 100, glow: 0, burst: 0, squeeze: 0, t: Math.random() * 40,
    parts: [], tend: [], motes: [], rips: []
  };
  for (let i = 0; i < 1100; i++) ob.parts.push(spawn(true));
  for (let i = 0; i < 9; i++) ob.tend.push({ a: Math.random() * TAU, w: (Math.random() - 0.5) * 0.6, ph: Math.random() * TAU, f: 0.3 + Math.random() * 0.6 });
  for (let i = 0; i < 30; i++) ob.motes.push({ a: Math.random() * TAU, r: 1.2 + Math.random() * 1.0, w: (Math.random() - 0.5) * 0.4, ph: Math.random() * TAU, s: 0.6 + Math.random() * 1.5 });

  const beat = () => {
    if (ob.mood !== 'late') return 0;
    const p = (ob.t % 1.7) / 1.7, g = (c, w) => Math.exp(-((p - c) * (p - c)) / (w * w));
    return g(0.08, 0.045) + 0.7 * g(0.26, 0.05);
  };
  const shape = (a, ph = 0) => { const t = ob.t; return 1 + 0.14 * Math.sin(3 * a + t * 0.7 + ob.seed + ph) + 0.08 * Math.sin(5 * a - t * 1.1 + ph) + 0.05 * Math.sin(8 * a + t * 1.9 + ob.seed * 2); };
  const size = () => ob.R * (1 + 0.045 * Math.sin(ob.t * 0.9) + 0.02 * Math.sin(ob.t * 2.3) + 0.07 * beat() + ob.burst * 0.22 + ob.glow * 0.04 - ob.squeeze * 0.16);

  // Float: a soft spring toward a target that itself wanders, so it drifts, overshoots a little and settles.
  function step(dt) {
    ob.spd += (ob.spdT - ob.spd) * Math.min(1, dt * 1.5);
    ob.t += dt * ob.spd;
    const P = PALS[ob.mood] || PALS.rest, k = Math.min(1, dt * 1.2);
    for (const key of Object.keys(ob.pal)) ob.pal[key] = mix(ob.pal[key], P[key], k);
    const t = ob.t, s = ob.seed;
    let gx = ob.tx + ob.wander * (0.7 * Math.sin(t * 0.13 + s) + 0.3 * Math.sin(t * 0.31 + s * 1.7));
    let gy = ob.ty + ob.wander * 0.5 * (0.7 * Math.sin(t * 0.17 + s * 0.6) + 0.3 * Math.sin(t * 0.43 + 1.3)) + Math.sin(t * 0.9) * 5;
    if (lean) { gx += lean.x; gy += lean.y; }
    // keep the light (and its glow) inside the window
    const m = Math.min(ob.R * 1.75, VIEW.w / 2 - 10, VIEW.h / 2 - 10);
    gx = Math.min(Math.max(gx, m), VIEW.w - m); gy = Math.min(Math.max(gy, m), VIEW.h - m);
    ob.vx += (gx - ob.x) * 2.2 * dt; ob.vy += (gy - ob.y) * 2.2 * dt;
    const damp = Math.pow(0.18, dt); ob.vx *= damp; ob.vy *= damp;
    ob.x += ob.vx * dt; ob.y += ob.vy * dt;
    ob.R += (ob.Rt - ob.R) * Math.min(1, dt * 2.2);
    ob.burst = Math.max(0, ob.burst - dt * 0.9);
    ob.squeeze = Math.max(0, ob.squeeze - dt * 4.5);
  }

  // The body: trails that swirl, breathe in and out, and smear as it moves (on the fading layer).
  function body(ctx, dt) {
    const t = ob.t, P = ob.pal, R = size(), sp = ob.spd;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of ob.parts) {
      const f = Math.sin(p.a * 3 + t * 0.6 + p.r * 4 + p.sd) + 0.6 * Math.sin(p.a * 5 - t * 0.9 + p.sd * 2);
      p.a += dt * sp * (p.w * (1.5 - p.r * 0.7) + 0.8 * f);
      p.r += dt * sp * (0.1 * Math.sin(t * 1.3 + p.a * 2 + p.sd) + 0.06 * f) + dt * ob.burst * 1.8 * (0.3 + p.r) - dt * ob.squeeze * 2.4 * p.r;
      p.life += dt * sp;
      if (p.r > 1.2 || p.r < 0.02 || p.life > p.max) { Object.assign(p, spawn(false)); continue; }
      const sh = shape(p.a);
      const x = ob.x + Math.cos(p.a) * p.r * R * sh, y = ob.y + Math.sin(p.a) * p.r * R * sh * 0.95;
      if (p.px !== null) {
        const fade = Math.sin(Math.PI * (p.life / p.max));
        const edge = p.r > 0.92 ? Math.max(0, 1 - (p.r - 0.92) / 0.28) : 1;
        const col = p.r < 0.28 ? mix(P.core, P.a, p.r / 0.28) : p.r < 0.7 ? mix(P.a, P.b, (p.r - 0.28) / 0.42) : mix(P.b, P.c, Math.min(1, (p.r - 0.7) / 0.4));
        ctx.strokeStyle = rgba(col, (0.5 + ob.glow * 0.15) * fade * edge);
        ctx.lineWidth = p.r < 0.3 ? 2.2 : 1.7 - p.wd * 0.8;
        ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(x, y); ctx.stroke();
      }
      p.px = x; p.py = y;
    }
    // tendrils: reach out, crackle, pull back
    for (const k of ob.tend) {
      k.a += dt * sp * k.w;
      const ext = Math.sin(t * k.f + k.ph);
      if (ext < 0.1) continue;
      const L = R * (0.75 + 0.6 * ext * ext + ob.burst * 0.8);
      ctx.strokeStyle = rgba(mix(P.a, P.c, 0.45), 0.13 * ext + ob.glow * 0.06);
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let i = 0; i <= 14; i++) {
        const u = i / 14, rr = R * 0.3 + (L - R * 0.3) * u;
        const a = k.a + (Math.sin(u * 9 + t * 3 + k.ph) * 0.07 + (Math.random() - 0.5) * 0.05) * u * 1.4 + Math.sin(t * 0.7 + k.ph) * 0.18 * u;
        const x = ob.x + Math.cos(a) * rr, y = ob.y + Math.sin(a) * rr;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    // white-hot heart, flickering rather than pulsing on a metronome
    const cr = R * (0.3 + 0.04 * Math.sin(t * 2.1) + 0.03 * Math.sin(t * 3.7 + 1) + 0.12 * beat() + ob.glow * 0.05);
    const g = ctx.createRadialGradient(ob.x, ob.y, 0, ob.x, ob.y, cr);
    g.addColorStop(0, rgba(P.core, 0.2)); g.addColorStop(0.4, rgba(P.tint, 0.08)); g.addColorStop(1, rgba(P.tint, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ob.x, ob.y, cr, 0, TAU); ctx.fill();
  }

  // The crisp layer: the glow it casts (kept inside the window, so it never ends in a hard
  // edge), the soft mass behind the swirls, drifting sparks, ripples.
  function aura(ctx, dt) {
    const t = ob.t, P = ob.pal, R = size();
    ctx.globalCompositeOperation = 'lighter';
    const reach = Math.max(R, Math.min(R * 3.4, ob.x, ob.y, VIEW.w - ob.x, VIEW.h - ob.y));
    const g = ctx.createRadialGradient(ob.x, ob.y, R * 0.2, ob.x, ob.y, reach);
    const hb = 0.2 + 0.05 * Math.sin(t * 0.9) + 0.12 * beat() + ob.glow * 0.08 + ob.burst * 0.15;
    g.addColorStop(0, rgba(P.halo, hb)); g.addColorStop(0.35, rgba(P.c, hb * 0.28)); g.addColorStop(1, rgba(P.c, 0));
    ctx.fillStyle = g; ctx.fillRect(ob.x - reach, ob.y - reach, reach * 2, reach * 2);
    for (let L = 0; L < 2; L++) {
      const k = L ? 0.62 : 0.95, ph = L ? 2.1 : 0;
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const a = i / 64 * TAU, r = R * k * shape(a, ph);
        const x = ob.x + Math.cos(a) * r, y = ob.y + Math.sin(a) * r * 0.95;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      const m = ctx.createRadialGradient(ob.x, ob.y, 0, ob.x, ob.y, R * k * 1.15);
      m.addColorStop(0, rgba(P.a, L ? 0.3 : 0.2)); m.addColorStop(0.55, rgba(P.b, L ? 0.12 : 0.1)); m.addColorStop(1, rgba(P.c, 0));
      ctx.fillStyle = m; ctx.fill();
    }
    for (const mo of ob.motes) {
      mo.a += dt * ob.spd * mo.w * 0.5;
      const rr = R * (mo.r + 0.12 * Math.sin(t * 0.5 + mo.ph) + ob.burst * 0.6);
      const x = ob.x + Math.cos(mo.a) * rr, y = ob.y + Math.sin(mo.a) * rr * 0.9 + Math.sin(t * 0.7 + mo.ph) * 6;
      const tw = 0.35 + 0.65 * Math.pow(Math.max(0, Math.sin(t * 1.7 * mo.s + mo.ph)), 3);
      ctx.fillStyle = rgba(mix(P.a, P.c, 0.3), 0.5 * tw);
      ctx.beginPath(); ctx.arc(x, y, mo.s, 0, TAU); ctx.fill();
      ctx.fillStyle = rgba(P.b, 0.08 * tw);
      ctx.beginPath(); ctx.arc(x, y, mo.s * 5, 0, TAU); ctx.fill();
    }
    ob.rips = ob.rips.filter((r) => (r.age += dt) < 1.6);
    for (const r of ob.rips) {
      if (r.age < 0) continue;
      const u = r.age / 1.6;
      ctx.strokeStyle = rgba(P.a, 0.55 * (1 - u)); ctx.lineWidth = 1.5 * (1 - u) + 0.3;
      ctx.beginPath(); ctx.arc(ob.x, ob.y, R * (1 + u * 5.5), 0, TAU); ctx.stroke();
    }
  }

  // A vein of light from the orb to a screen, with sparks running along it.
  function vein(ctx, ex, ey, v, i, bright) {
    if (v < 0.01) return;
    const t = ob.t, P = ob.pal;
    const dx = ex - ob.x, dy = ey - ob.y, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d;
    const sx = ob.x + dx / d * ob.R * 0.6, sy = ob.y + dy / d * ob.R * 0.6;
    const tx = sx + (ex - sx) * v, ty = sy + (ey - sy) * v;
    ctx.globalCompositeOperation = 'lighter';
    for (let s = 0; s < 3; s++) {
      const w1 = Math.sin(t * 0.8 + i * 1.7 + s * 2.1) * (30 + s * 10), w2 = Math.sin(t * 1.15 + i * 2.3 + s) * -(24 + s * 8);
      const c1x = sx + (tx - sx) * 0.33 + nx * w1, c1y = sy + (ty - sy) * 0.33 + ny * w1;
      const c2x = sx + (tx - sx) * 0.66 + nx * w2, c2y = sy + (ty - sy) * 0.66 + ny * w2;
      const gr = ctx.createLinearGradient(sx, sy, tx, ty);
      gr.addColorStop(0, rgba(P.a, (s ? 0.18 : 0.42) * bright)); gr.addColorStop(1, rgba(P.c, (s ? 0.06 : 0.22) * bright));
      ctx.strokeStyle = gr; ctx.lineWidth = s ? 0.7 : 1.3;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.bezierCurveTo(c1x, c1y, c2x, c2y, tx, ty); ctx.stroke();
      if (s) continue;
      for (let k = 0; k < 3; k++) {
        const u = ((t * 0.45 + k / 3 + i * 0.13) % 1) * v;
        if (u > v - 0.02) continue;
        const q = u / v, a = 1 - q;
        const bx = a * a * a * sx + 3 * a * a * q * c1x + 3 * a * q * q * c2x + q * q * q * tx;
        const by = a * a * a * sy + 3 * a * a * q * c1y + 3 * a * q * q * c2y + q * q * q * ty;
        ctx.fillStyle = rgba(P.core, 0.75 * bright * Math.sin(Math.PI * q));
        ctx.beginPath(); ctx.arc(bx, by, 1.8, 0, TAU); ctx.fill();
        ctx.fillStyle = rgba(P.b, 0.15 * bright * Math.sin(Math.PI * q));
        ctx.beginPath(); ctx.arc(bx, by, 7, 0, TAU); ctx.fill();
      }
    }
    if (v > 0.98) { // where it touches the screen
      const gg = ctx.createRadialGradient(ex, ey, 0, ex, ey, 26);
      gg.addColorStop(0, rgba(P.a, 0.45 * bright)); gg.addColorStop(1, rgba(P.a, 0));
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(ex, ey, 26, 0, TAU); ctx.fill();
    }
  }

  // ------------------------------------------------------------ canvases and layout
  const cvBg = $('#bg'), cvTr = $('#tr');
  let bg = null, tr = null, fadeN = 0;
  const VIEW = { state: 'closed', x: 0, y: 0, w: window.innerWidth || 720, h: window.innerHeight || 520, hx: 360, hy: 260 };
  function fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const cv of [cvBg, cvTr]) {
      cv.width = Math.round(VIEW.w * dpr); cv.height = Math.round(VIEW.h * dpr);
      cv.style.width = `${VIEW.w}px`; cv.style.height = `${VIEW.h}px`;
    }
    bg = cvBg.getContext('2d'); tr = cvTr.getContext('2d');
    bg.setTransform(dpr, 0, 0, dpr, 0, 0); tr.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const p of ob.parts) p.px = null;
  }
  function fade(dt) {
    tr.globalCompositeOperation = 'destination-out';
    tr.fillStyle = `rgba(0,0,0,${(1 - Math.pow(0.95, dt * 60)).toFixed(3)})`;
    tr.fillRect(0, 0, VIEW.w, VIEW.h);
    if (++fadeN % 6 === 0) { tr.fillStyle = 'rgba(0,0,0,0.3)'; tr.fillRect(0, 0, VIEW.w, VIEW.h); } // clears the faint residue a plain fade leaves
  }
  // Home and the open centre, in window pixels.
  const homeX = () => VIEW.hx - VIEW.x;
  const homeY = () => VIEW.hy - VIEW.y;
  const midX = () => VIEW.w / 2;
  const midY = () => VIEW.h / 2;

  let dragShift = false;
  O.onLayout((l) => {
    if (!l) return;
    const dx = VIEW.x - l.x, dy = VIEW.y - l.y;
    const resized = l.w !== VIEW.w || l.h !== VIEW.h;
    Object.assign(VIEW, l);
    if (dragShift) dragShift = false; // the window moved with the orb in it: nothing to shift
    else if (dx || dy) { ob.x += dx; ob.y += dy; for (const p of ob.parts) p.px = null; }
    if (resized || !bg) fit();
    else if (dx || dy) tr.clearRect(0, 0, VIEW.w, VIEW.h);
    if (l.state === 'open' && S.open && !S.shown) bloom();
    if (resized || dx || dy || !S.open) place();
  });

  // ------------------------------------------------------------ the six screens
  const PANS = [...document.querySelectorAll('.ob-pan')];
  // Where each sits around the open centre (same arrangement as the board's mockup).
  const SPOTS = { today: [-340, -262], cal: [0, -312], tasks: [340, -262], notes: [390, 108], comms: [0, 316], rec: [-390, 108] };
  const PW = 290, PH = 176, FS = 1.6;
  const S = { open: false, shown: false, focus: null, origin: { x: 0, y: 0 }, busy: false, snap: null, rec: null, recAt: 0, lines: [], shrinkAt: 0, openAt: 0 };
  const vs = PANS.map(() => 0);
  const panCenter = (el) => { const [ox, oy] = SPOTS[el.dataset.k]; return { x: midX() + ox, y: midY() + oy }; };
  const focusSpot = () => ({ x: midX() + 185, y: midY() });

  function place() {
    for (const el of PANS) {
      const c = panCenter(el);
      el.style.left = `${Math.round(c.x - PW / 2)}px`;
      el.style.top = `${Math.round(c.y - PH / 2)}px`;
    }
    paintPans();
  }
  function paintPans(instant) {
    const open = S.open && S.shown;
    PANS.forEach((el, i) => {
      const c = panCenter(el);
      let tf, op = 1, dl, z = 4, fl = 'none';
      if (!open) { tf = `translate(${S.origin.x - c.x}px, ${S.origin.y - c.y}px) scale(0.06)`; op = 0; dl = `${(5 - i) * 0.03}s`; }
      else if (S.focus === el) { const f = focusSpot(); tf = `translate(${f.x - c.x}px, ${f.y - c.y}px) scale(${FS})`; z = 5; dl = '0s'; }
      else if (S.focus) { tf = `translate(${(c.x - midX()) * 0.12}px, ${(c.y - midY()) * 0.12}px) scale(0.82)`; op = 0.25; fl = 'blur(2px)'; dl = '0s'; }
      else { tf = 'translate(0px, 0px) scale(1)'; dl = `${0.4 + i * 0.09}s`; }
      if (!open && !instant && el.getAnimations().length) return; // flying in: leave it
      if (instant) el.style.transition = 'none';
      el.style.transform = tf; el.style.opacity = String(op); el.style.transitionDelay = dl; el.style.zIndex = String(z); el.style.filter = fl;
      el.classList.toggle('on', S.focus === el);
      if (instant) { void el.offsetWidth; el.style.transition = ''; }
    });
  }
  // Opening: the orb draws in for a beat, then bursts, and each screen is carried out on its
  // vein: a blurred, over-bright speck that flies out along a curve, unfolds, overshoots a
  // touch and settles, a glint crosses it, then its contents fade up. Closing pulls them back in.
  const OPEN_STYLE = { transform: 'translate(0px, 0px) scale(1)', opacity: '1', filter: 'none' };
  const glints = PANS.map((el) => { const g = document.createElement('i'); g.className = 'ob-glint'; el.appendChild(g); return g; });
  const settle = (el, a) => a.finished.then(() => { el.style.transition = ''; }).catch(() => {});
  function flyOut() {
    PANS.forEach((el, i) => {
      el.getAnimations({ subtree: true }).forEach((a) => a.cancel());
      const c = panCenter(el), dx = ob.x - c.x, dy = ob.y - c.y, d = Math.hypot(dx, dy) || 1;
      const bend = (i % 2 ? 1 : -1) * 0.16 * d, nx = (-dy / d) * bend, ny = (dx / d) * bend;
      el.style.transition = 'none';
      Object.assign(el.style, OPEN_STYLE, { zIndex: '4', transitionDelay: '0s' });
      el.classList.remove('on');
      const delay = 40 + i * 115;
      settle(el, el.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(0.04)`, opacity: 0, filter: 'blur(14px) brightness(2.4)', offset: 0 },
        { transform: `translate(${dx * 0.45 + nx}px, ${dy * 0.45 + ny}px) scale(0.38, 0.22)`, opacity: 0.85, filter: 'blur(7px) brightness(1.9)', offset: 0.42 },
        { transform: `translate(${-dx * 0.02}px, ${-dy * 0.02}px) scale(1.035, 0.985)`, opacity: 1, filter: 'blur(0px) brightness(1.35)', offset: 0.78 },
        { transform: 'translate(0px, 0px) scale(1)', opacity: 1, filter: 'blur(0px) brightness(1)', offset: 1 }
      ], { duration: 1150, delay, easing: 'cubic-bezier(.22,.8,.26,1)', fill: 'backwards' }));
      for (const ch of el.children) {
        if (ch === glints[i]) continue;
        ch.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0px)' }], { duration: 500, delay: delay + 760, easing: 'ease-out', fill: 'backwards' });
      }
      glints[i].animate([{ opacity: 0, backgroundPosition: '130% 0' }, { opacity: 1, offset: 0.3 }, { opacity: 0, backgroundPosition: '-30% 0' }], { duration: 1000, delay: delay + 620, easing: 'ease-out' });
    });
  }
  function flyIn() {
    PANS.forEach((el, i) => {
      const cs = getComputedStyle(el);
      const from = { transform: cs.transform === 'none' ? 'translate(0px, 0px) scale(1)' : cs.transform, opacity: Number(cs.opacity), filter: S.focus && S.focus !== el ? 'blur(2px) brightness(1)' : 'blur(0px) brightness(1)' };
      el.getAnimations({ subtree: true }).forEach((a) => a.cancel());
      const c = panCenter(el), dx = ob.x - c.x, dy = ob.y - c.y;
      el.style.transition = 'none';
      Object.assign(el.style, { transform: `translate(${dx}px, ${dy}px) scale(0.04)`, opacity: '0', filter: 'none' });
      el.classList.remove('on');
      if (from.opacity < 0.02) return;
      settle(el, el.animate([
        from,
        { transform: `translate(${dx * 0.6}px, ${dy * 0.6}px) scale(0.35, 0.2)`, opacity: Math.min(from.opacity, 0.7), filter: 'blur(6px) brightness(1.8)', offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.04)`, opacity: 0, filter: 'blur(12px) brightness(2.4)', offset: 1 }
      ], { duration: 640, delay: (5 - i) * 45, easing: 'cubic-bezier(.55,0,.8,.35)', fill: 'backwards' }));
    });
  }
  function openOrb() {
    if (S.open) return;
    S.open = true; S.shown = false; S.focus = null; S.shrinkAt = 0;
    ob.squeeze = 1; // draw in…
    document.body.dataset.state = 'opening';
    O.layout('open'); // brings the window forward (it doesn't change size any more)
    setTimeout(() => { if (S.open && !S.shown) bloom(); }, 180); // …then burst
  }
  function bloom() {
    S.shown = true; S.openAt = performance.now();
    ob.burst = 1; ob.rips.push({ age: 0 }, { age: -0.22 });
    document.body.dataset.state = 'open';
    flyOut();
  }
  function closeOrb() {
    if (!S.open) return;
    flyIn();
    S.open = false; S.shown = false; S.focus = null;
    ob.squeeze = 0.6; setTimeout(() => { if (!S.open) { ob.burst = 0.35; ob.rips.push({ age: 0 }); } }, 560);
    document.body.dataset.state = 'closing';
    S.shrinkAt = performance.now();
    const a = document.activeElement; if (a && a.blur) a.blur();
  }
  function setFocus(el) {
    S.focus = el && S.focus !== el ? el : null;
    paintPans();
    if (S.focus && S.focus.dataset.k === 'comms') setTimeout(() => $('#cin').focus(), 300);
  }

  // ------------------------------------------------------------ what the screens show
  const pad2 = (n) => String(n).padStart(2, '0');
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function tick() {
    const d = new Date(), h24 = S.snap && S.snap.clock24;
    const h = d.getHours();
    $('#clk').textContent = h24 ? `${pad2(h)}:${pad2(d.getMinutes())}` : `${h % 12 || 12}:${pad2(d.getMinutes())}`;
    $('#ampm').textContent = h24 ? '' : h < 12 ? 'AM' : 'PM';
    $('#date').textContent = `${DAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`;
    const linked = S.snap && Date.now() - S.snap.at < 3 * 60 * 1000;
    $('#link').textContent = linked ? 'DECK LINKED' : 'WAITING ON THE DECK';
    $('#link').classList.toggle('off', !linked);
    if (S.rec) paintRecTime();
  }
  function paintSnap() {
    const s = S.snap;
    if (!s) return;
    $('#wx').textContent = s.wx || '';
    $('#hello').textContent = s.hello || '';
    $('#evs').innerHTML = s.events.length
      ? s.events.map((e) => `<div class="${e.now ? 'now' : e.soon ? 'soon' : ''}"><b>${esc(e.when)}</b><span>${esc(e.title)}</span></div>`).join('')
      : '<div class="ob-empty">Nothing coming up.</div>';
    $('#tks').innerHTML = s.tasks.length
      ? s.tasks.map((t) => `<div class="${t.late ? 'late' : ''}" data-id="${esc(t.id)}"><button type="button" class="ob-ck" data-done="${esc(t.id)}" aria-label="Mark ${esc(t.title)} done"></button><span>${esc(t.title)}</span><em>${t.late ? 'LATE' : esc(t.due)}</em></div>`).join('')
      : '<div class="ob-empty">All clear. Nothing open.</div>';
    $('#tkMore').textContent = s.more ? `+${s.more}` : '';
    $('#nts').innerHTML = s.notes.length
      ? s.notes.map((n) => `<div class="${n.recap ? 'rc' : ''}" data-note="${esc(n.id)}"><b>${esc(n.title)}</b><span>${esc(n.sub)}</span></div>`).join('')
      : '<div class="ob-empty">No notes yet.</div>';
    tick();
    mood();
  }
  function paintChat() {
    const box = $('#chat');
    box.innerHTML = S.lines.slice(-30).map((l) => {
      if (l.k === 'card') return `<div class="card">${esc(l.head || '✓')}${(l.fields || []).map(([k, v]) => `<br>${esc(k)} · ${esc(v)}`).join('')}</div>`;
      return `<div class="${l.k === 'you' ? 'you' : l.k === 'err' ? 'err' : ''}">${esc(l.t)}</div>`;
    }).join('') + (S.busy ? '<div class="busy">…</div>' : '');
    box.scrollTop = box.scrollHeight;
  }
  // The recorder
  const recOn = () => S.rec && ['recording', 'paused', 'starting'].includes(S.rec.state);
  function recMs() {
    if (!S.rec) return 0;
    return (S.rec.elapsed || 0) + (S.rec.state === 'recording' ? Date.now() - S.recAt : 0);
  }
  const clockOf = (ms) => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600); return `${h ? `${h}:` : ''}${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`; };
  function paintRecTime() { $('#recTime').textContent = clockOf(recMs()); }
  function paintRec() {
    const on = recOn();
    $('#recIdle').hidden = on; $('#recLive').hidden = !on;
    document.body.dataset.rec = on ? S.rec.state : '';
    if (on) {
      $('#recTitle').textContent = S.rec.title || 'Meeting';
      $('#recPause').textContent = S.rec.state === 'paused' ? 'RESUME' : 'PAUSE';
      paintRecTime();
    }
    $('#recDrop').classList.remove('arm'); $('#recDrop').textContent = 'DISCARD';
    mood();
  }
  function mood() {
    const m = recOn() ? 'rec' : S.busy ? 'thinking' : S.snap && S.snap.late ? 'late' : S.snap && S.snap.soon ? 'soon' : 'rest';
    ob.mood = m;
    document.body.dataset.mood = m;
    const still = S.snap && S.snap.motion === 'still';
    ob.spdT = (SPEED[m] || 1) * (still ? 0.35 : 1);
  }

  O.onState((st) => {
    if (!st) return;
    if (st.snap) { S.snap = st.snap; paintSnap(); }
    if (st.rec) { S.rec = st.rec; S.recAt = Date.now(); paintRec(); }
    if (st.line) { S.lines.push(st.line); if (S.lines.length > 60) S.lines.splice(0, S.lines.length - 60); paintChat(); }
    if (typeof st.busy === 'boolean') { S.busy = st.busy; paintChat(); mood(); }
  });
  O.onToggle(() => { if (S.open) closeOrb(); else openOrb(); });

  // ------------------------------------------------------------ hands
  let lean = null;
  let mouse = null;
  const near = (x, y) => Math.hypot(x - ob.x, y - ob.y) < ob.R * 1.25;
  document.addEventListener('mousemove', (e) => { mouse = { x: e.clientX, y: e.clientY }; });
  document.addEventListener('mouseleave', () => { mouse = null; });

  // Click the orb: open / close. Click empty space: send a screen back, or fold away.
  // Press and drag the closed orb: move its home.
  let press = null, dragging = false, swallow = false;
  cvTr.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    press = { x: e.clientX, y: e.clientY, sx: e.screenX, sy: e.screenY, onOrb: near(e.clientX, e.clientY) };
    if (press.onOrb && !S.open) cvTr.setPointerCapture(e.pointerId);
  });
  cvTr.addEventListener('pointermove', (e) => {
    if (!press || !press.onOrb || S.open) return;
    if (!dragging && Math.hypot(e.screenX - press.sx, e.screenY - press.sy) > 6) {
      dragging = true; document.body.classList.add('drag');
      O.drag('start', press.sx, press.sy);
    }
    if (dragging) O.drag('move', e.screenX, e.screenY);
  });
  cvTr.addEventListener('pointerup', (e) => {
    if (dragging) {
      dragging = false; swallow = true; dragShift = true;
      document.body.classList.remove('drag');
      O.drag('end', e.screenX, e.screenY);
    }
    press = null;
  });
  cvTr.addEventListener('click', (e) => {
    if (swallow) { swallow = false; return; }
    if (near(e.clientX, e.clientY)) { if (S.open) closeOrb(); else openOrb(); return; }
    if (S.open && S.focus) setFocus(null);
    else if (S.open) closeOrb();
  });
  $('#pans').addEventListener('click', (e) => {
    if (!S.open) return;
    const done = e.target.closest('[data-done]');
    if (done) {
      const row = done.closest('[data-id]');
      if (row && !row.classList.contains('done')) { row.classList.add('done'); O.act({ kind: 'done', id: done.dataset.done }); }
      return;
    }
    if (e.target.closest('[data-note]')) { O.act({ kind: 'deck' }); return; }
    if (e.target.closest('button, input, form')) return;
    const pan = e.target.closest('.ob-pan');
    if (pan) setFocus(pan);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (S.focus) setFocus(null); else closeOrb();
  });
  $('#cform').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('#cin').value.trim();
    if (!t) return;
    $('#cin').value = '';
    O.act({ kind: 'send', text: t });
  });
  const tg = (id) => $(id).addEventListener('click', (e) => { const b = e.currentTarget; b.classList.toggle('on'); b.setAttribute('aria-pressed', String(b.classList.contains('on'))); });
  tg('#recSys'); tg('#recMic');
  $('#recGo').addEventListener('click', () => {
    const sys = $('#recSys').classList.contains('on'), mic = $('#recMic').classList.contains('on');
    if (!sys && !mic) { S.lines.push({ k: 'err', t: 'Pick computer audio, your mic, or both.' }); paintChat(); return; }
    O.act({ kind: 'rec', action: 'start', title: $('#recName').value.trim(), sys, mic });
    $('#recName').value = '';
  });
  $('#recPause').addEventListener('click', () => O.act({ kind: 'rec', action: S.rec && S.rec.state === 'paused' ? 'resume' : 'pause' }));
  $('#recStop').addEventListener('click', () => O.act({ kind: 'rec', action: 'stop' }));
  $('#recDrop').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'SURE? CLICK AGAIN'; setTimeout(() => { b.classList.remove('arm'); b.textContent = 'DISCARD'; }, 4000); return; }
    O.act({ kind: 'rec', action: 'discard' });
  });

  // ------------------------------------------------------------ the loop
  const hub = $('#hubTime'), tip = $('#tip');
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const still = S.snap && S.snap.motion === 'still';
    // where it wants to be
    if (S.open && S.shown) {
      if (S.focus) { ob.tx = midX() - 340; ob.ty = midY(); ob.wander = 10; ob.Rt = 60; }
      else { ob.tx = midX(); ob.ty = midY(); ob.wander = 14; ob.Rt = 76; }
    } else { ob.tx = homeX(); ob.ty = homeY(); ob.wander = still ? 0 : S.open ? 14 : 190; ob.Rt = 92; }
    // curious: leans toward the pointer, brightens under it
    lean = null;
    let over = false;
    if (mouse && !dragging) {
      const d = Math.hypot(mouse.x - ob.x, mouse.y - ob.y);
      if (d < 320) lean = { x: (mouse.x - ob.x) * 0.14, y: (mouse.y - ob.y) * 0.14 };
      over = d < ob.R * 1.25;
    }
    cvTr.style.cursor = dragging ? 'grabbing' : over ? 'pointer' : 'default';
    document.body.classList.toggle('hover', over);
    ob.glow += ((over ? 1 : 0) - ob.glow) * Math.min(1, dt * 4);
    step(dt);
    // fold the window back down once the orb is home
    if (!S.open && S.shrinkAt && (Math.hypot(ob.x - homeX(), ob.y - homeY()) < 40 || now - S.shrinkAt > 2500)) {
      S.shrinkAt = 0; S.shown = false;
      document.body.dataset.state = 'closed';
      O.layout('closed');
    }
    if (bg) {
      bg.globalCompositeOperation = 'source-over';
      bg.clearRect(0, 0, VIEW.w, VIEW.h);
      aura(bg, dt);
      PANS.forEach((el, i) => {
        // the veins carry the screens: each is drawn to where its screen is right now
        const want = S.focus && S.focus !== el ? 0 : 1;
        vs[i] += (want - vs[i]) * Math.min(1, dt * 4);
        const op = Number(getComputedStyle(el).opacity) * vs[i];
        if (op < 0.02) return;
        const r = el.getBoundingClientRect();
        if (r.width < 2) return;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2, hw = r.width / 2, hh = r.height / 2;
        const dx = ob.x - cx, dy = ob.y - cy;
        if (Math.hypot(dx, dy) < ob.R * 0.7) return;
        const k = Math.min(1, hw / Math.max(1, Math.abs(dx)), hh / Math.max(1, Math.abs(dy)));
        vein(bg, cx + dx * k, cy + dy * k, 1, i, (S.focus === el ? 1.4 : 1) * op);
      });
      fade(dt);
      body(tr, dt);
    }
    const R = size();
    hub.textContent = recOn() ? `● ${clockOf(recMs())}` : '';
    hub.style.transform = `translate(${Math.round(ob.x - hub.offsetWidth / 2)}px, ${Math.round(ob.y + R * 1.25)}px)`;
    tip.style.transform = `translate(${Math.round(ob.x - tip.offsetWidth / 2)}px, ${Math.round(ob.y + R * 1.25 + (recOn() ? 20 : 0))}px)`;
    requestAnimationFrame(loop);
  }
  fit();
  ob.x = homeX(); ob.y = homeY();
  place();
  paintRec();
  mood();
  setInterval(tick, 1000);
  tick();
  requestAnimationFrame(loop);
  window.__orb = { open: openOrb, close: closeOrb, focus: (k) => setFocus(PANS.find((p) => p.dataset.k === k) || null), state: () => ({ open: S.open, shown: S.shown, focus: S.focus && S.focus.dataset.k, mood: ob.mood, x: ob.x, y: ob.y }) };
})();
