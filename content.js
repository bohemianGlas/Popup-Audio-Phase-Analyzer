'use strict';

(function () {
  const OVERLAY_ID = '__audio_analyzer_9f3c__';

  // 既存オーバーレイがあれば表示トグル
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    existing.style.display = existing.style.display === 'none' ? 'flex' : 'none';
    return;
  }

  const OW = 700, OH = 284; // 初期サイズ (タイトルバー24px + コンテンツ260px)
  const initLeft = Math.max(0, window.innerWidth - OW - 20);

  // ── オーバーレイ外枠 ──────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  set(overlay, {
    position:      'fixed',
    top:           '20px',
    left:          initLeft + 'px',
    width:         OW + 'px',
    height:        OH + 'px',
    minWidth:      '480px',
    minHeight:     '220px',
    zIndex:        '2147483647',
    display:       'flex',
    flexDirection: 'column',
    boxShadow:     '0 12px 40px rgba(0,0,0,0.85)',
    border:        '1px solid #2a2a2a',
    borderRadius:  '5px',
    overflow:      'hidden',
    boxSizing:     'border-box',
  });

  // ── タイトルバー（ドラッグ用） ────────────────────────────────────────
  const bar = document.createElement('div');
  set(bar, {
    background:      '#181818',
    height:          '24px',
    minHeight:       '24px',
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'space-between',
    padding:         '0 10px',
    cursor:          'move',
    borderBottom:    '1px solid #252525',
    flexShrink:      '0',
    userSelect:      'none',
    webkitUserSelect:'none',
    boxSizing:       'border-box',
  });

  const title = document.createElement('span');
  title.textContent = 'AUDIO ANALYZER';
  set(title, { color: '#444', font: '9px/24px monospace', letterSpacing: '3px' });

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  set(closeBtn, {
    background: 'none', border: 'none', color: '#555',
    cursor: 'pointer', fontSize: '16px', lineHeight: '1',
    padding: '0', margin: '0', fontFamily: 'monospace',
  });
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#bbb'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#555'; });
  closeBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stopAnalyzer' }).catch(() => {});
    overlay.remove();
  });

  bar.appendChild(title);
  bar.appendChild(closeBtn);

  // ── iframe（popup.html を読み込む） ───────────────────────────────────
  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('popup.html');
  set(iframe, {
    flex:      '1',
    border:    'none',
    display:   'block',
    width:     '100%',
    minHeight: '0',
  });

  // ── リサイズハンドル（右下三角） ──────────────────────────────────────
  const resizeHandle = document.createElement('div');
  set(resizeHandle, {
    position: 'absolute',
    bottom:   '0',
    right:    '0',
    width:    '16px',
    height:   '16px',
    cursor:   'nwse-resize',
    zIndex:   '1',
  });
  resizeHandle.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 16 16" style="display:block">' +
    '<path d="M16,0 L16,16 L0,16 Z" fill="#3a3a3a"/></svg>';

  overlay.appendChild(bar);
  overlay.appendChild(iframe);
  overlay.appendChild(resizeHandle);
  document.documentElement.appendChild(overlay);

  // ── 状態変数 ──────────────────────────────────────────────────────────
  let dragging  = false, dragX, dragY, dragL, dragT;
  let resizing  = false, resX, resY, resW, resH;

  // ── ドラッグ ──────────────────────────────────────────────────────────
  bar.addEventListener('mousedown', function (e) {
    if (e.target === closeBtn) return;
    dragging = true;
    dragX = e.clientX;
    dragY = e.clientY;
    dragL = parseInt(overlay.style.left) || 0;
    dragT = parseInt(overlay.style.top)  || 0;
    iframe.style.pointerEvents = 'none'; // iframe がイベントを奪わないようにする
    e.preventDefault();
  });

  // ── リサイズ ──────────────────────────────────────────────────────────
  resizeHandle.addEventListener('mousedown', function (e) {
    resizing = true;
    resX = e.clientX;
    resY = e.clientY;
    resW = overlay.offsetWidth;
    resH = overlay.offsetHeight;
    iframe.style.pointerEvents = 'none';
    e.preventDefault();
    e.stopPropagation();
  });

  // ── mousemove（ドラッグ＆リサイズ共通） ──────────────────────────────
  document.addEventListener('mousemove', function (e) {
    if (dragging) {
      overlay.style.left = Math.max(0, dragL + e.clientX - dragX) + 'px';
      overlay.style.top  = Math.max(0, dragT + e.clientY - dragY) + 'px';
    }
    if (resizing) {
      overlay.style.width  = Math.max(480, resW + e.clientX - resX) + 'px';
      overlay.style.height = Math.max(220, resH + e.clientY - resY) + 'px';
    }
  });

  // ── mouseup ───────────────────────────────────────────────────────────
  document.addEventListener('mouseup', function () {
    if (dragging || resizing) {
      iframe.style.pointerEvents = 'auto';
    }
    dragging = false;
    resizing = false;
  });

  // ── ユーティリティ ────────────────────────────────────────────────────
  function set(el, props) {
    Object.assign(el.style, props);
  }
})();
