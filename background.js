'use strict';

let captureTabId = null;

function getStreamId(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(id);
    });
  });
}

async function setupOffscreen(streamId) {
  // 既存の offscreen document を閉じる
  try { await chrome.offscreen.closeDocument(); } catch (_) {}
  // stream ID をURLハッシュに埋め込んで渡す（メッセージ往復による失効を防ぐ）
  await chrome.offscreen.createDocument({
    url:           chrome.runtime.getURL('offscreen.html') + '#' + streamId,
    reasons:       ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'tabCapture で奪われたタブ音声をタブ外から再生するパススルー',
  });
}

chrome.action.onClicked.addListener(async (tab) => {
  captureTabId = tab.id;

  // 既にキャプチャ中（オーバーレイを閉じるトグル）なら offscreen を再作成しない
  const alreadyCapturing = await chrome.offscreen.hasDocument().catch(() => false);
  if (!alreadyCapturing) {
    try {
      const sid = await getStreamId(tab.id);
      await setupOffscreen(sid);
    } catch (e) {
      console.error('Offscreen setup failed:', e.message);
    }
  }

  // ページにオーバーレイ (content.js) を注入
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files:  ['content.js'],
    });
  } catch (e) {
    console.error('Script injection failed:', e.message);
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // content.js → オーバーレイ閉じ時のクリーンアップ
  if (request.action === 'stopAnalyzer') {
    chrome.runtime.sendMessage({ action: 'stopPlayback' }).catch(() => {});
    setTimeout(() => chrome.offscreen.closeDocument().catch(() => {}), 300);
    return true;
  }
});
