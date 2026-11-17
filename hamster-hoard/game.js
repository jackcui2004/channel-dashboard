'use strict';
/* 仓鼠囤粮 Hamster Hoard — core logic + animation state. */

const PALETTE = {
  s: '#A9DEF2', k: '#5B3A29', w: '#FFFDF6', y: '#FFD94D',
  o: '#FF9F43', r: '#FF6B6B', p: '#FFB3C7', g: '#7BD88F',
  d: '#3E9B4F', b: '#A9714B', l: '#E8C39E', u: '#C9A8E8',
  c: '#6BCBFF', n: '#3D5A80', e: '#2F4858'
};
const EMPTY_COLOR = '#F3E3C2';
const GRID_LINE = '#E5D3AC';
const CHAPTERS = [
  { name: '第一章 · 坚果小院', from: 0, to: 5 },
  { name: '第二章 · 水果花园', from: 5, to: 10 },
  { name: '第三章 · 甜点小铺', from: 10, to: 15 },
  { name: '第四章 · 丰收派对', from: 15, to: 20 }
];
const SAVE_KEY = 'hamster-hoard-v1';
const LOGICAL_W = 480;

/* ---------- save ---------- */
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s === 'object') {
      return Object.assign({ unlocked: 1, stars: {}, sound: true, speed: 1 }, s);
    }
  } catch (e) { /* ignore */ }
  return { unlocked: 1, stars: {}, sound: true, speed: 1 };
}
let save = loadSave();
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
}

/* ---------- audio (tiny WebAudio bleeps, no assets) ---------- */
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* ignore */ }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
function beep(freq, dur, type, vol, slideTo) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  gain.gain.setValueAtTime(vol || 0.12, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}
let lastNibbleAt = 0;
function sfx(name) {
  if (!save.sound) return;
  ensureAudio();
  if (!audioCtx) return;
  const now = performance.now();
  if (name === 'place') beep(520, 0.08, 'square', 0.08, 880);
  else if (name === 'nibble') {
    if (now - lastNibbleAt < 90) return;
    lastNibbleAt = now;
    beep(1100 + Math.random() * 500, 0.035, 'triangle', 0.05);
  } else if (name === 'bad') beep(160, 0.15, 'sawtooth', 0.07, 110);
  else if (name === 'click') beep(700, 0.05, 'sine', 0.07);
  else if (name === 'hint') { beep(880, 0.09, 'sine', 0.1); setTimeout(() => beep(1174, 0.12, 'sine', 0.1), 90); }
  else if (name === 'win') { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.16, 'triangle', 0.12), i * 110)); }
  else if (name === 'fail') { beep(300, 0.2, 'sawtooth', 0.07, 140); }
}

/* ---------- level state ---------- */
let levelIndex = 0;
let G = null;

function newLevelState(lv) {
  const speckles = [];
  let seed = 1234567 + levelIndex * 97;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 26; i++) speckles.push({ x: rnd(), y: rnd(), r: 1 + rnd() * 2 });
  return {
    lv: lv, n: lv.size,
    eaten: new Set(), reserved: new Set(),
    slots: [null, null, null, null, null],
    trayPos: lv.tray.cols.map(() => 0),
    hamsters: [], particles: [],
    flyingBox: null,
    over: false, won: false, overlayShown: false, overAt: 0,
    hintsLeft: 2, hintsUsed: 0,
    placements: [],
    speed: save.speed || 1,
    spawnTimer: 0, checkTimer: 0,
    hintFlash: null,
    tipStep: -1, tipHideAt: 0,
    speckles: speckles,
    shakeUntil: 0,
    lastRemain: -1
  };
}

/* ---------- layout (logical 480 wide) ---------- */
function computeLayout() {
  const framePad = 14, picSize = 400;
  const picX = (LOGICAL_W - picSize) / 2, picY = framePad;
  const cell = picSize / G.n;
  const dirtY = picY + picSize + framePad, dirtH = 52;
  const slotSize = 62, slotGap = 10;
  const slotsW = 5 * slotSize + 4 * slotGap;
  const slotX = (LOGICAL_W - slotsW) / 2, slotY = dirtY + dirtH + 8;
  const boxW = 76, boxH = 52, colGap = 12, rowGap = 8;
  const trayW = 5 * boxW + 4 * colGap;
  const trayX = (LOGICAL_W - trayW) / 2, trayY = slotY + slotSize + 14;
  const maxDepth = Math.max.apply(null, G.lv.tray.cols.map(c => c.length));
  const trayH = maxDepth * boxH + (maxDepth - 1) * rowGap;
  const H = trayY + trayH + 16;
  return {
    W: LOGICAL_W, H: H,
    picX: picX, picY: picY, picSize: picSize, cell: cell,
    dirtY: dirtY, dirtH: dirtH,
    holeX: LOGICAL_W / 2, holeY: dirtY + dirtH / 2,
    slotX: slotX, slotY: slotY, slotSize: slotSize, slotGap: slotGap,
    trayX: trayX, trayY: trayY, boxW: boxW, boxH: boxH, colGap: colGap, rowGap: rowGap,
    maxDepth: maxDepth
  };
}
let L = null;
function slotCenter(i) {
  return { x: L.slotX + i * (L.slotSize + L.slotGap) + L.slotSize / 2, y: L.slotY + L.slotSize / 2 };
}
function trayBoxRect(ci, rowJ) {
  return {
    x: L.trayX + ci * (L.boxW + L.colGap),
    y: L.trayY + rowJ * (L.boxH + L.rowGap),
    w: L.boxW, h: L.boxH
  };
}
function cellCenter(idx) {
  const r = (idx / G.n) | 0, c = idx % G.n;
  return { x: L.picX + (c + 0.5) * L.cell, y: L.picY + (r + 0.5) * L.cell };
}

/* ---------- core rules ---------- */
function isExposed(idx) {
  if (G.eaten.has(idx)) return false;
  const n = G.n, r = (idx / n) | 0, c = idx % n;
  if (r === 0 || c === 0 || r === n - 1 || c === n - 1) return true;
  return G.eaten.has(idx - n) || G.eaten.has(idx + n) || G.eaten.has(idx - 1) || G.eaten.has(idx + 1);
}
function pickTarget(color) {
  // bottom-most, then left-most exposed unreserved cell of this color (same rule as the solver)
  let best = -1, bestR = -1, bestC = 1e9;
  for (let r = 0; r < G.n; r++) {
    for (let c = 0; c < G.n; c++) {
      const idx = r * G.n + c;
      if (G.eaten.has(idx) || G.reserved.has(idx)) continue;
      if (G.lv.grid[r][c] !== color) continue;
      if (!isExposed(idx)) continue;
      if (r > bestR || (r === bestR && c < bestC)) { best = idx; bestR = r; bestC = c; }
    }
  }
  return best;
}
function spawnHamster(slotIdx, color, target) {
  const from = slotCenter(slotIdx);
  const tc = cellCenter(target);
  const stageX = Math.max(L.picX + 12, Math.min(L.picX + L.picSize - 12, tc.x));
  const jx = (Math.random() - 0.5) * 14;
  G.hamsters.push({
    color: color, target: target,
    x: from.x, y: from.y,
    wps: [{ x: stageX + jx, y: L.dirtY + 2 }, { x: tc.x, y: tc.y }],
    wp: 0, state: 'go', nibbleT: 0, carrying: false,
    speed: 175, wobble: Math.random() * Math.PI * 2, facing: 1
  });
}
function tryPlace(colIdx) {
  if (!G || G.over) return;
  const col = G.lv.tray.cols[colIdx];
  const pos = G.trayPos[colIdx];
  if (pos >= col.length) return;
  const freeSlot = G.slots.findIndex(s => !s);
  if (freeSlot < 0) {
    G.shakeUntil = performance.now() + 300;
    toast('槽位满了，等仓鼠吃完一盒');
    sfx('bad');
    return;
  }
  const box = col[pos];
  G.trayPos[colIdx]++;
  G.placements.push(colIdx);
  const rect = trayBoxRect(colIdx, 0);
  G.slots[freeSlot] = { color: box.c, remaining: box.n, flying: true };
  G.flyingBox = {
    color: box.c, n: box.n, slot: freeSlot,
    from: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
    to: slotCenter(freeSlot), t: 0
  };
  sfx('place');
  advanceTip();
}
function advanceTip() {
  if (levelIndex !== 0 || !G) return;
  if (G.tipStep === 0 && G.placements.length >= 1) showTip(1);
  else if (G.tipStep === 1 && G.placements.length >= 2) showTip(2);
  else if (G.tipStep === 2 && G.placements.length >= 3) hideTip();
}

/* ---------- update loop ---------- */
function update(dt, now) {
  if (!G) return;
  const dtMs = dt * 1000;
  // flying box
  if (G.flyingBox) {
    G.flyingBox.t += dtMs / 180;
    if (G.flyingBox.t >= 1) {
      const s = G.slots[G.flyingBox.slot];
      if (s) s.flying = false;
      G.flyingBox = null;
    }
  }
  // spawning
  if (!G.over) {
    G.spawnTimer -= dtMs;
    if (G.spawnTimer <= 0) {
      G.spawnTimer = 240 / G.speed;
      for (let si = 0; si < 5; si++) {
        const slot = G.slots[si];
        if (!slot || slot.flying || slot.remaining <= 0) continue;
        const t = pickTarget(slot.color);
        if (t < 0) continue;
        G.reserved.add(t);
        slot.remaining--;
        spawnHamster(si, slot.color, t);
        if (slot.remaining <= 0) G.slots[si] = null;
      }
    }
  }
  // hamsters
  for (let i = G.hamsters.length - 1; i >= 0; i--) {
    const h = G.hamsters[i];
    if (h.state === 'nibble') {
      h.nibbleT -= dtMs;
      if (h.nibbleT <= 0) {
        G.eaten.add(h.target);
        G.reserved.delete(h.target);
        h.carrying = true;
        h.state = 'back';
        const tc = cellCenter(h.target);
        h.wps = [{ x: tc.x, y: L.dirtY + 2 }, { x: L.holeX, y: L.holeY }];
        h.wp = 0;
        sfx('nibble');
        burst(tc.x, tc.y, PALETTE[h.color], 3);
      }
      continue;
    }
    const wp = h.wps[h.wp];
    if (!wp) { G.hamsters.splice(i, 1); continue; }
    const dx = wp.x - h.x, dy = wp.y - h.y;
    const dist = Math.hypot(dx, dy);
    const step = h.speed * G.speed * dt;
    if (Math.abs(dx) > 0.5) h.facing = dx > 0 ? 1 : -1;
    if (dist <= step) {
      h.x = wp.x; h.y = wp.y;
      h.wp++;
      if (h.wp >= h.wps.length) {
        if (h.state === 'go') {
          h.state = 'nibble';
          h.nibbleT = 170 / G.speed;
        } else {
          burst(L.holeX, L.holeY - 6, '#8A6B4A', 2);
          G.hamsters.splice(i, 1);
        }
      }
    } else {
      h.x += dx / dist * step;
      h.y += dy / dist * step;
    }
  }
  // particles
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i];
    p.life -= dtMs;
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt;
    if (p.life <= 0) G.particles.splice(i, 1);
  }
  // remain counter
  const remain = G.n * G.n - G.eaten.size;
  if (remain !== G.lastRemain) {
    G.lastRemain = remain;
    const el = document.getElementById('remain-count');
    if (el) el.textContent = remain;
  }
  // tutorial tip auto-hide
  if (G.tipStep === 2 && G.tipHideAt && now > G.tipHideAt) hideTip();
  // end checks
  if (!G.over) {
    G.checkTimer -= dtMs;
    if (G.checkTimer <= 0) { G.checkTimer = 250; checkEnd(); }
  } else if (!G.overlayShown && now - G.overAt > 550) {
    G.overlayShown = true;
    if (G.won) showWin(); else showFail();
  }
}
function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    G.particles.push({
      x: x, y: y,
      vx: (Math.random() - 0.5) * 70, vy: -30 - Math.random() * 50,
      life: 350 + Math.random() * 250, color: color, size: 3 + Math.random() * 3
    });
  }
}
function checkEnd() {
  if (!G || G.over) return;
  const total = G.n * G.n;
  if (G.eaten.size >= total) { endLevel(true); return; }
  if (G.hamsters.length > 0 || G.flyingBox) return;
  for (const s of G.slots) {
    if (s && !s.flying && s.remaining > 0 && pickTarget(s.color) >= 0) return;
  }
  const freeExists = G.slots.some(s => !s);
  if (freeExists) {
    for (let ci = 0; ci < 5; ci++) {
      const col = G.lv.tray.cols[ci], pos = G.trayPos[ci];
      if (pos < col.length && pickTarget(col[pos].c) >= 0) return;
    }
  }
  endLevel(false);
}
function endLevel(won) {
  G.over = true;
  G.won = won;
  G.overAt = performance.now();
  hideTip();
  if (won) {
    const stars = Math.max(1, 3 - G.hintsUsed);
    const prev = save.stars[levelIndex] || 0;
    if (stars > prev) save.stars[levelIndex] = stars;
    if (levelIndex + 1 < LEVELS.length) save.unlocked = Math.max(save.unlocked, levelIndex + 2);
    else save.unlocked = Math.max(save.unlocked, LEVELS.length);
    persist();
    sfx('win');
  } else {
    sfx('fail');
  }
}

/* ---------- hints ---------- */
function useHint() {
  if (!G || G.over || G.hintsLeft <= 0) return;
  G.hintsLeft--;
  G.hintsUsed++;
  document.getElementById('hint-count').textContent = G.hintsLeft;
  document.getElementById('hint-btn').disabled = G.hintsLeft <= 0;
  const sol = G.lv.solution;
  let col = -1;
  for (let k = G.placements.length; k < sol.length; k++) {
    const ci = sol[k];
    if (G.trayPos[ci] < G.lv.tray.cols[ci].length) {
      const b = G.lv.tray.cols[ci][G.trayPos[ci]];
      if (pickTarget(b.c) >= 0) { col = ci; break; }
    }
  }
  if (col < 0) {
    for (let ci = 0; ci < 5; ci++) {
      if (G.trayPos[ci] < G.lv.tray.cols[ci].length) {
        const b = G.lv.tray.cols[ci][G.trayPos[ci]];
        if (pickTarget(b.c) >= 0) { col = ci; break; }
      }
    }
  }
  if (col < 0) {
    for (let ci = 0; ci < 5; ci++) {
      if (G.trayPos[ci] < G.lv.tray.cols[ci].length) { col = ci; break; }
    }
  }
  if (col >= 0) G.hintFlash = { col: col, until: performance.now() + 3000 };
  sfx('hint');
}

/* ---------- rendering ---------- */
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

function setupCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = L.W * dpr;
  canvas.height = L.H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}
function drawBox(c, x, y, w, h, color, num, alpha, glow) {
  c.save();
  c.globalAlpha = alpha == null ? 1 : alpha;
  const hex = PALETTE[color];
  roundRect(c, x, y, w, h, 10);
  c.fillStyle = hex;
  c.fill();
  c.fillStyle = 'rgba(0,0,0,0.12)';
  roundRect(c, x, y + h - 12, w, 12, 10);
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = shade(hex, -55);
  roundRect(c, x + 1.5, y + 1.5, w - 3, h - 3, 9);
  c.stroke();
  if (glow) {
    c.lineWidth = 4;
    c.strokeStyle = '#FFB84D';
    roundRect(c, x - 3, y - 3, w + 6, h + 6, 13);
    c.stroke();
  }
  c.fillStyle = '#FFFFFF';
  c.font = 'bold ' + Math.round(h * 0.52) + 'px "ZCOOL KuaiLe", sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.shadowColor = 'rgba(0,0,0,0.25)';
  c.shadowBlur = 3;
  c.fillText(String(num), x + w / 2, y + h / 2 + 1);
  c.restore();
}
function drawHamster(c, x, y, color, facing, phase, carrying, scale) {
  const s = scale || 1;
  const hex = PALETTE[color];
  c.save();
  c.translate(x, y + Math.sin(phase) * 1.2 * s);
  c.scale(facing * s, s);
  // feet
  const step = Math.sin(phase * 2) * 2;
  c.fillStyle = shade(hex, -40);
  c.fillRect(-7, 5 + step * 0.4, 5, 3);
  c.fillRect(2, 5 - step * 0.4, 5, 3);
  // tail
  c.fillStyle = shade(hex, 30);
  c.beginPath(); c.arc(-10, 0, 3, 0, Math.PI * 2); c.fill();
  // body
  c.fillStyle = hex;
  c.beginPath(); c.ellipse(0, 0, 11, 8, 0, 0, Math.PI * 2); c.fill();
  // belly
  c.fillStyle = 'rgba(255,253,246,0.85)';
  c.beginPath(); c.ellipse(2, 3, 6, 4, 0, 0, Math.PI * 2); c.fill();
  // ears
  c.fillStyle = hex;
  c.beginPath(); c.arc(-5, -8, 3.4, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(4, -8, 3.4, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#FFB3C7';
  c.beginPath(); c.arc(-5, -8, 1.6, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(4, -8, 1.6, 0, Math.PI * 2); c.fill();
  // eye + nose (front = +x)
  c.fillStyle = '#2F4858';
  c.beginPath(); c.arc(6, -2, 1.7, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#FF8FA3';
  c.beginPath(); c.arc(10.5, 1, 1.5, 0, Math.PI * 2); c.fill();
  // carried tile
  if (carrying) {
    c.fillStyle = hex;
    c.strokeStyle = shade(hex, -55);
    c.lineWidth = 1.5;
    c.save();
    c.translate(-2, -15);
    c.rotate(-0.12);
    c.fillRect(-5, -5, 10, 10);
    c.strokeRect(-5, -5, 10, 10);
    c.restore();
  }
  c.restore();
}
function draw(now) {
  if (!G || !L) return;
  const c = ctx;
  c.clearRect(0, 0, L.W, L.H);
  // page card background
  c.fillStyle = '#FFFDF6';
  roundRect(c, 2, 2, L.W - 4, L.H - 4, 16);
  c.fill();
  // picture frame
  c.fillStyle = '#E8C39E';
  roundRect(c, L.picX - L.cell * 0 + 0 - 8, L.picY - 8, L.picSize + 16, L.picSize + 16, 12);
  c.fill();
  c.fillStyle = GRID_LINE;
  c.fillRect(L.picX, L.picY, L.picSize, L.picSize);
  // cells
  for (let r = 0; r < G.n; r++) {
    for (let cc = 0; cc < G.n; cc++) {
      const idx = r * G.n + cc;
      const x = L.picX + cc * L.cell, y = L.picY + r * L.cell;
      c.fillStyle = G.eaten.has(idx) ? EMPTY_COLOR : PALETTE[G.lv.grid[r][cc]];
      c.fillRect(x + 0.5, y + 0.5, L.cell - 1, L.cell - 1);
    }
  }
  // dirt strip
  c.fillStyle = '#C9A37E';
  roundRect(c, L.picX - 8, L.dirtY, L.picSize + 16, L.dirtH, 12);
  c.fill();
  c.fillStyle = 'rgba(91,58,41,0.18)';
  for (const sp of G.speckles) {
    c.beginPath();
    c.arc(L.picX - 8 + sp.x * (L.picSize + 16), L.dirtY + sp.y * L.dirtH, sp.r, 0, Math.PI * 2);
    c.fill();
  }
  // burrow hole
  c.fillStyle = '#3A2415';
  c.beginPath(); c.ellipse(L.holeX, L.holeY + 4, 34, 15, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.beginPath(); c.ellipse(L.holeX, L.holeY + 7, 24, 9, 0, 0, Math.PI * 2); c.fill();
  // slots
  const shaking = now < G.shakeUntil;
  const shX = shaking ? Math.sin(now / 28) * 3 : 0;
  for (let i = 0; i < 5; i++) {
    const sc = slotCenter(i);
    const x = sc.x - L.slotSize / 2 + shX, y = sc.y - L.slotSize / 2;
    const slot = G.slots[i];
    if (!slot) {
      c.save();
      c.setLineDash([6, 5]);
      c.lineWidth = 2.5;
      c.strokeStyle = '#C9A37E';
      roundRect(c, x, y, L.slotSize, L.slotSize, 12);
      c.stroke();
      c.restore();
    } else if (!slot.flying) {
      drawBox(c, x, y, L.slotSize, L.slotSize, slot.color, slot.remaining, 1, false);
      drawHamster(c, sc.x + shX, y - 2, slot.color, 1, now / 300 + i, false, 0.62);
    }
  }
  // flying box
  if (G.flyingBox) {
    const f = G.flyingBox;
    const t = Math.min(1, f.t);
    const ease = 1 - Math.pow(1 - t, 2);
    const x = f.from.x + (f.to.x - f.from.x) * ease;
    const y = f.from.y + (f.to.y - f.from.y) * ease - Math.sin(t * Math.PI) * 24;
    drawBox(c, x - L.slotSize / 2, y - L.slotSize / 2, L.slotSize, L.slotSize, f.color, f.n, 1, false);
  }
  // tray
  const flashCol = G.hintFlash && now < G.hintFlash.until ? G.hintFlash.col : -1;
  for (let ci = 0; ci < 5; ci++) {
    const col = G.lv.tray.cols[ci];
    const pos = G.trayPos[ci];
    for (let j = 0; j + pos < col.length; j++) {
      const b = col[pos + j];
      const rect = trayBoxRect(ci, j);
      const front = j === 0;
      const glow = front && ci === flashCol && Math.sin(now / 130) > -0.2;
      drawBox(c, rect.x, rect.y, rect.w, rect.h, b.c, b.n, front ? 1 : 0.5, glow);
    }
  }
  // hamsters (sorted by y)
  const hs = G.hamsters.slice().sort((a, b) => a.y - b.y);
  for (const h of hs) {
    const phase = now / 90 + h.wobble;
    drawHamster(c, h.x, h.y, h.color, h.facing, phase, h.carrying, 1);
  }
  // particles
  for (const p of G.particles) {
    c.globalAlpha = Math.max(0, p.life / 500);
    c.fillStyle = p.color;
    c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  c.globalAlpha = 1;
}

/* ---------- input ---------- */
canvas.addEventListener('pointerdown', (ev) => {
  ensureAudio();
  if (!G || G.over) return;
  const rect = canvas.getBoundingClientRect();
  const x = (ev.clientX - rect.left) / rect.width * L.W;
  const y = (ev.clientY - rect.top) / rect.height * L.H;
  for (let ci = 0; ci < 5; ci++) {
    const r = trayBoxRect(ci, 0);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
      tryPlace(ci);
      return;
    }
  }
});
canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

/* ---------- tips / toast ---------- */
const TIPS = [
  '点最前排的盒子，放出同色的小仓鼠',
  '再放一盒，仓鼠会从外往里啃',
  '巢里只有 5 个格子，吃不到的颜色会一直占着，全堵住就输啦！把整幅画吃光就过关'
];
function showTip(step) {
  if (!G) return;
  G.tipStep = step;
  const el = document.getElementById('tip-bubble');
  el.textContent = TIPS[step];
  el.style.display = 'block';
  const scale = canvas.clientWidth / L.W;
  el.style.top = ((L.dirtY - 12) * scale - el.offsetHeight) + 'px';
  if (step === 2) G.tipHideAt = performance.now() + 6000;
}
function hideTip() {
  if (G) G.tipStep = -1;
  document.getElementById('tip-bubble').style.display = 'none';
}
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ---------- screens ---------- */
const menuScreen = document.getElementById('menu-screen');
const gameScreen = document.getElementById('game-screen');
function showMenu() {
  G = null;
  hideTip();
  gameScreen.classList.remove('active');
  menuScreen.classList.add('active');
  renderMenu();
  document.querySelectorAll('.overlay').forEach(o => o.classList.remove('show'));
}
function thumbFor(lv, size) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const c = cv.getContext('2d');
  const cell = size / lv.size;
  for (let r = 0; r < lv.size; r++) {
    for (let cc = 0; cc < lv.size; cc++) {
      c.fillStyle = PALETTE[lv.grid[r][cc]];
      c.fillRect(cc * cell, r * cell, cell + 0.5, cell + 0.5);
    }
  }
  return cv;
}
function renderMenu() {
  menuScreen.innerHTML = '';
  for (const ch of CHAPTERS) {
    const sec = document.createElement('div');
    sec.className = 'chapter';
    const h = document.createElement('h2');
    h.textContent = ch.name;
    sec.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'level-grid';
    for (let i = ch.from; i < ch.to && i < LEVELS.length; i++) {
      const lv = LEVELS[i];
      const locked = i + 1 > save.unlocked;
      const card = document.createElement('div');
      card.className = 'level-card' + (locked ? ' locked' : '');
      card.appendChild(thumbFor(lv, 120));
      const nm = document.createElement('div');
      nm.className = 'lv-name';
      nm.textContent = lv.name.replace(/^\d+\.\s*/, '');
      card.appendChild(nm);
      const st = document.createElement('div');
      st.className = 'lv-stars';
      const n = save.stars[i] || 0;
      st.textContent = locked ? '' : '★'.repeat(n) + '☆'.repeat(3 - n);
      card.appendChild(st);
      if (locked) {
        const lk = document.createElement('div');
        lk.className = 'lock';
        lk.textContent = '🔒';
        card.appendChild(lk);
      } else {
        card.addEventListener('click', () => { ensureAudio(); sfx('click'); startLevel(i); });
      }
      grid.appendChild(card);
    }
    sec.appendChild(grid);
    menuScreen.appendChild(sec);
  }
  const foot = document.createElement('div');
  foot.className = 'menu-foot';
  foot.innerHTML = '点颜色盒放出仓鼠，从外往里啃光整幅画就过关。<br>巢里只有 5 个格子，顺序放错就会堵住哦！';
  menuScreen.appendChild(foot);
}
function startLevel(idx) {
  levelIndex = idx;
  G = newLevelState(LEVELS[idx]);
  L = computeLayout();
  setupCanvas();
  document.getElementById('lv-name').textContent = LEVELS[idx].name;
  document.getElementById('lv-diff').textContent = LEVELS[idx].diff;
  document.getElementById('remain-count').textContent = G.n * G.n;
  document.getElementById('hint-count').textContent = '2';
  document.getElementById('hint-btn').disabled = false;
  document.getElementById('speed-btn').textContent = (G.speed === 2 ? '2x' : '1x');
  document.querySelectorAll('.overlay').forEach(o => o.classList.remove('show'));
  menuScreen.classList.remove('active');
  gameScreen.classList.add('active');
  if (idx === 0) {
    setTimeout(() => {
      if (!G || levelIndex !== 0) return;
      if (G.placements.length >= 2) showTip(2);
      else if (G.placements.length >= 1) showTip(1);
      else showTip(0);
    }, 350);
  }
  window.scrollTo(0, 0);
}
function showWin() {
  const stars = Math.max(1, 3 - G.hintsUsed);
  const el = document.getElementById('win-stars');
  el.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const sp = document.createElement('span');
    sp.textContent = '★';
    if (i >= stars) sp.className = 'off';
    el.appendChild(sp);
  }
  const last = levelIndex + 1 >= LEVELS.length;
  document.getElementById('win-text').textContent = last
    ? '全部 20 关都通关啦，仓鼠的粮仓堆满了！'
    : '「' + LEVELS[levelIndex].name + '」已囤好，下一关解锁了！';
  document.getElementById('win-next-btn').style.display = last ? 'none' : '';
  document.getElementById('win-overlay').classList.add('show');
}
function showFail() {
  document.getElementById('fail-overlay').classList.add('show');
}

/* ---------- controls ---------- */
document.getElementById('back-btn').addEventListener('click', () => { sfx('click'); showMenu(); });
document.getElementById('restart-btn').addEventListener('click', () => { sfx('click'); startLevel(levelIndex); });
document.getElementById('hint-btn').addEventListener('click', () => useHint());
document.getElementById('speed-btn').addEventListener('click', (ev) => {
  const ns = (save.speed === 2) ? 1 : 2;
  save.speed = ns;
  persist();
  if (G) G.speed = ns;
  ev.currentTarget.textContent = ns === 2 ? '2x' : '1x';
  sfx('click');
});
const soundBtn = document.getElementById('sound-btn');
function refreshSoundBtn() { soundBtn.textContent = save.sound ? '🔊' : '🔇'; }
soundBtn.addEventListener('click', () => {
  save.sound = !save.sound;
  persist();
  refreshSoundBtn();
  if (save.sound) { ensureAudio(); sfx('click'); }
});
document.getElementById('win-menu-btn').addEventListener('click', () => { sfx('click'); showMenu(); });
document.getElementById('win-replay-btn').addEventListener('click', () => { sfx('click'); startLevel(levelIndex); });
document.getElementById('win-next-btn').addEventListener('click', () => {
  sfx('click');
  if (levelIndex + 1 < LEVELS.length) startLevel(levelIndex + 1);
});
document.getElementById('fail-menu-btn').addEventListener('click', () => { sfx('click'); showMenu(); });
document.getElementById('fail-retry-btn').addEventListener('click', () => { sfx('click'); startLevel(levelIndex); });
document.addEventListener('pointerdown', ensureAudio, { once: false });
window.addEventListener('resize', () => { if (G && L) setupCanvas(); });

/* ---------- logo + boot ---------- */
(function drawLogo() {
  const cv = document.getElementById('logo-hamster');
  const c = cv.getContext('2d');
  c.setTransform(2, 0, 0, 2, 0, 0);
  drawHamster(c, 38, 42, 'l', 1, 0.6, true, 1.7);
})();

let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (G && gameScreen.classList.contains('active')) {
    update(dt, now);
    draw(now);
  }
  requestAnimationFrame(loop);
}
refreshSoundBtn();
renderMenu();
requestAnimationFrame(loop);
