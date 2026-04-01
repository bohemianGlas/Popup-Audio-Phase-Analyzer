'use strict';

// ── Constants ─────────────────────────────────────────────────────────────
const FFT_SIZE       = 2048;
const MIN_DB         = -40;
const MAX_DB         = 0;
const GREEN_LIMIT    = -6;   // green: MIN_DB … -6
const YELLOW_LIMIT   = -3;   // yellow: -6 … -3  | red: -3 … MAX_DB
const PEAK_HOLD_MS   = 1500;
const PEAK_FALL_DB   = 0.35; // dB per animation frame
const SCALE_MARKS    = [-40, -30, -20, -10, -6, -3, 0];

// ── Canvas elements ────────────────────────────────────────────────────────
const meterLCanvas = document.getElementById('meter-l');
const meterRCanvas = document.getElementById('meter-r');
const scaleCanvas  = document.getElementById('scale-canvas');
const lissCanvas   = document.getElementById('lissajous-canvas');
const corrCanvas   = document.getElementById('corr-canvas');

// ── Peak hold state ───────────────────────────────────────────────────────

const peakHold = {
  L: { val: -Infinity, heldAt: 0 },
  R: { val: -Infinity, heldAt: 0 },
};

// ── Utility ────────────────────────────────────────────────────────────────
function dbToX(db, w) {
  return ((Math.max(MIN_DB, Math.min(MAX_DB, db)) - MIN_DB) / (MAX_DB - MIN_DB)) * w;
}

function bufPeakDb(buf) {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > peak) peak = a;
  }
  return peak < 1e-7 ? -Infinity : 20 * Math.log10(peak);
}

function pearson(a, b) {
  const n = a.length;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  if (va < 1e-12 || vb < 1e-12) return 0;
  return Math.max(-1, Math.min(1, cov / Math.sqrt(va * vb)));
}

// ── Canvas sizing ──────────────────────────────────────────────────────────
function fitCanvas(canvas) {
  const p = canvas.parentElement;
  const w = p.clientWidth, h = p.clientHeight;
  if (w > 0 && h > 0) { canvas.width = w; canvas.height = h; }
}

function resizeAll() {
  fitCanvas(meterLCanvas);
  fitCanvas(meterRCanvas);
  fitCanvas(scaleCanvas);
  // lissajous は正方形固定
  const lp = lissCanvas.parentElement;
  const size = Math.min(lp.clientWidth, lp.clientHeight);
  if (size > 0) { lissCanvas.width = size; lissCanvas.height = size; }
  fitCanvas(corrCanvas);
  drawScale();
  const ctx = lissCanvas.getContext('2d');
  ctx.fillStyle = '#080808';
  ctx.fillRect(0, 0, lissCanvas.width, lissCanvas.height);
}

// ── dB Scale ──────────────────────────────────────────────────────────────
function drawScale() {
  const ctx = scaleCanvas.getContext('2d');
  const w = scaleCanvas.width, h = scaleCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.font = '8px monospace';
  for (const db of SCALE_MARKS) {
    const x = Math.round(dbToX(db, w));
    ctx.fillStyle = '#444';
    ctx.fillRect(x, 0, 1, 4);
    ctx.fillStyle = '#666';
    ctx.textAlign = db === MIN_DB ? 'left' : db === MAX_DB ? 'right' : 'center';
    ctx.fillText(String(db), db === MIN_DB ? x : db === MAX_DB ? x : x, h);
  }
}

// ── Peak meter ────────────────────────────────────────────────────────────
function drawMeter(canvas, db, holdDb) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, w, h);

  const fillX = isFinite(db) ? dbToX(db, w) : 0;
  const gx    = dbToX(GREEN_LIMIT, w);
  const yx    = dbToX(YELLOW_LIMIT, w);
  const bh    = Math.ceil(h * 0.42); // bright highlight band height

  // Green segment: 0 → gx
  if (fillX > 0) {
    const seg = Math.min(fillX, gx);
    ctx.fillStyle = '#005a00';
    ctx.fillRect(0, 1, seg, h - 2);
    ctx.fillStyle = '#00cc00';
    ctx.fillRect(0, 1, seg, bh);
  }
  // Yellow segment: gx → yx
  if (fillX > gx) {
    const seg = Math.min(fillX - gx, yx - gx);
    ctx.fillStyle = '#777700';
    ctx.fillRect(gx, 1, seg, h - 2);
    ctx.fillStyle = '#dddd00';
    ctx.fillRect(gx, 1, seg, bh);
  }
  // Red segment: yx → fillX
  if (fillX > yx) {
    const seg = fillX - yx;
    ctx.fillStyle = '#7a0000';
    ctx.fillRect(yx, 1, seg, h - 2);
    ctx.fillStyle = '#ee0000';
    ctx.fillRect(yx, 1, seg, bh);
  }

  // Peak hold line
  if (isFinite(holdDb) && holdDb > MIN_DB - 1) {
    const hx = Math.min(w - 2, dbToX(holdDb, w));
    ctx.fillStyle = holdDb >= YELLOW_LIMIT ? '#ff5555'
                  : holdDb >= GREEN_LIMIT  ? '#ffff55'
                  : '#55ff55';
    ctx.fillRect(Math.max(0, hx - 1), 0, 2, h);
  }

  // Zone dividers (subtle)
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(Math.round(gx), 1, 1, h - 2);
  ctx.fillRect(Math.round(yx), 1, 1, h - 2);
}

// ── Lissajous ─────────────────────────────────────────────────────────────
function drawLissajous(bL, bR) {
  const ctx = lissCanvas.getContext('2d');
  const w = lissCanvas.width, h = lissCanvas.height;
  if (w < 2 || h < 2) return;

  // Persistence fade
  ctx.fillStyle = 'rgba(8,8,8,0.20)';
  ctx.fillRect(0, 0, w, h);

  const cx = w * 0.5, cy = h * 0.5;
  const s  = Math.min(cx, cy) * 0.92;

  // Reference lines
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, 2);        ctx.lineTo(cx, h - 2);
  ctx.moveTo(2, cy);        ctx.lineTo(w - 2, cy);
  ctx.moveTo(cx - s, cy + s); ctx.lineTo(cx + s, cy - s); // +45 (mono)
  ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s); // -45 (anti)
  ctx.stroke();

  // Reference circle
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.beginPath();
  ctx.arc(cx, cy, s, 0, Math.PI * 2);
  ctx.stroke();

  // ゴニオメーター変換: 縦軸=MID(L+R)、右45°=R、左45°=L
  const SQRT2_INV = 1 / Math.sqrt(2);
  ctx.strokeStyle = 'rgba(0, 210, 90, 0.88)';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < bL.length; i++) {
    const gx = (bR[i] - bL[i]) * SQRT2_INV;
    const gy = (bL[i] + bR[i]) * SQRT2_INV;
    const x = cx + gx * s;
    const y = cy - gy * s;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  // (axis labels intentionally removed)
}

// ── Correlation bar ───────────────────────────────────────────────────────
function drawCorr(corr) {
  const ctx = corrCanvas.getContext('2d');
  const w = corrCanvas.width, h = corrCanvas.height;

  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, w, h);

  const cx   = w * 0.5;
  const barH = h - 14;
  const len  = Math.abs(corr) * cx;

  if (corr > 0) {
    const g = ctx.createLinearGradient(cx, 0, cx + len, 0);
    g.addColorStop(0, '#004400');
    g.addColorStop(1, '#00aa00');
    ctx.fillStyle = g;
    ctx.fillRect(cx, 1, len, barH - 2);
  } else if (corr < 0) {
    const g = ctx.createLinearGradient(cx - len, 0, cx, 0);
    g.addColorStop(0, '#880000');
    g.addColorStop(1, '#440000');
    ctx.fillStyle = g;
    ctx.fillRect(cx - len, 1, len, barH - 2);
  }

  // Tick marks
  ctx.fillStyle = '#282828';
  for (const v of [-1, -0.5, 0, 0.5, 1]) {
    ctx.fillRect(Math.round((v + 1) * 0.5 * w), 0, 1, barH);
  }

  // Center mark
  ctx.fillStyle = '#555';
  ctx.fillRect(Math.round(cx) - 1, 0, 2, barH);

  // Scale labels
  ctx.font = '8px monospace';
  ctx.fillStyle = '#444';
  ctx.textAlign = 'left';   ctx.fillText('-1', 2, h - 2);
  ctx.textAlign = 'center'; ctx.fillText('0',  cx, h - 2);
  ctx.textAlign = 'right';  ctx.fillText('+1', w - 2, h - 2);

  // Correlation numeric value
  ctx.fillStyle = corr > 0.3 ? '#00cc00' : corr < -0.1 ? '#cc4444' : '#888';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(corr.toFixed(3), cx, Math.round(barH * 0.5) + 5);

  ctx.strokeStyle = '#252525';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

// ── Peak hold logic ───────────────────────────────────────────────────────
function updateHold(ch, db) {
  const h = peakHold[ch];
  const now = performance.now();
  if (!isFinite(db)) db = -Infinity;
  if (db >= h.val) {
    h.val = db;
    h.heldAt = now;
  } else if (now - h.heldAt > PEAK_HOLD_MS) {
    h.val = isFinite(h.val) ? Math.max(h.val - PEAK_FALL_DB, db) : db;
  }
}

// ── offscreen.js からのフレームデータを受信して描画 ───────────────────────
chrome.runtime.onMessage.addListener(function(request) {
  if (request.action !== 'frame') return;
  const bL = new Float32Array(request.bufL);
  const bR = new Float32Array(request.bufR);
  const dbL = bufPeakDb(bL);
  const dbR = bufPeakDb(bR);
  updateHold('L', dbL);
  updateHold('R', dbR);
  drawMeter(meterLCanvas, dbL, peakHold.L.val);
  drawMeter(meterRCanvas, dbR, peakHold.R.val);
  drawLissajous(bL, bR);
  drawCorr(pearson(bL, bR));
});

// ── Resize handle ─────────────────────────────────────────────────────────
(function initResize() {
  // iframe内（ページ上オーバーレイ）では外側コンテンツスクリプトがリサイズを管理する
  if (window !== window.top) {
    const handle = document.getElementById('resize-handle');
    if (handle) handle.style.display = 'none'; // 三角を非表示
    window.addEventListener('resize', resizeAll); // iframe サイズ変更を検知
    return;
  }

  // スタンドアロンウィンドウモード
  const handle = document.getElementById('resize-handle');
  let dragging = false, ox, oy, startOuterW, startOuterH;

  handle.addEventListener('mousedown', function(e) {
    dragging = true;
    ox = e.screenX;
    oy = e.screenY;
    startOuterW = window.outerWidth;
    startOuterH = window.outerHeight;
    e.preventDefault();
  });

  window.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    const newOuterW = Math.max(500, startOuterW + e.screenX - ox);
    const newOuterH = Math.max(230, startOuterH + e.screenY - oy);
    window.resizeTo(newOuterW, newOuterH);
    resizeAll();
  });

  window.addEventListener('mouseup', function() {
    dragging = false;
  });

  window.addEventListener('resize', resizeAll);
})();

// ── Entry point ────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', function() {
  resizeAll();
  document.getElementById('loading').style.display = 'none';
});
