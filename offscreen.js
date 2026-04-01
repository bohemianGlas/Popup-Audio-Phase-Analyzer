'use strict';

const FFT_SIZE = 2048;
let audioCtx  = null;
let stream    = null;
let analyserL = null;
let analyserR = null;
const bufL = new Float32Array(FFT_SIZE);
const bufR = new Float32Array(FFT_SIZE);

// stream ID は background.js が URL ハッシュに埋め込んで渡す
const streamId = location.hash.slice(1);

(async () => {
  if (!streamId) { console.error('Offscreen: stream ID が見つかりません'); return; }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource:   'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });
  } catch (e) {
    console.error('Offscreen getUserMedia failed:', e);
    return;
  }

  audioCtx = new AudioContext();
  const src      = audioCtx.createMediaStreamSource(stream);
  const splitter = audioCtx.createChannelSplitter(2);

  src.connect(audioCtx.destination); // タブ外から再生 → フィードバックなし
  src.connect(splitter);

  analyserL = audioCtx.createAnalyser();
  analyserR = audioCtx.createAnalyser();
  for (const a of [analyserL, analyserR]) {
    a.fftSize               = FFT_SIZE;
    a.smoothingTimeConstant = 0;
  }
  splitter.connect(analyserL, 0);
  splitter.connect(analyserR, 1);

  // 解析データを popup.js へ送信（約30fps）
  setInterval(sendFrame, 33);
})();

function sendFrame() {
  if (!analyserL || !analyserR) return;
  analyserL.getFloatTimeDomainData(bufL);
  analyserR.getFloatTimeDomainData(bufR);
  chrome.runtime.sendMessage({
    action: 'frame',
    bufL:   Array.from(bufL),
    bufR:   Array.from(bufR),
  }).catch(() => {}); // popup が未表示でも無視
}

// stopPlayback を受け取ったらトラックを解放
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'stopPlayback') {
    analyserL = null;
    analyserR = null;
    if (stream)   { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
  }
});
