const OFFSCREEN_URL = 'offscreen.html';

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.some((context) => context.documentUrl?.endsWith(OFFSCREEN_URL))) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Capture the active tab audio for local speech recognition.'
  });
}

async function startCapture(tabId) {
  await ensureOffscreen();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await chrome.runtime.sendMessage({ type: 'START_TAB_CAPTURE', streamId, tabId });
  await chrome.storage.local.set({ captureState: 'capturing', sourceTabId: tabId });
}

async function stopCapture() {
  try { await chrome.runtime.sendMessage({ type: 'STOP_TAB_CAPTURE' }); } catch (error) { /* offscreen may not exist */ }
  await chrome.storage.local.set({ captureState: 'paused' });
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ captureState: 'idle' });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  // This user gesture grants activeTab for the current page. Start capture here
  // instead of relying only on a later Side Panel click.
  await chrome.sidePanel.open({ tabId: tab.id });
  const current = await chrome.storage.local.get('captureState');
  if (current.captureState === 'capturing') await stopCapture();
  else {
    try {
      await startCapture(tab.id);
    } catch (error) {
      await chrome.runtime.sendMessage({ type: 'CAPTURE_ERROR', error: error.message });
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TOGGLE_CAPTURE_FROM_PANEL') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) throw new Error('没有找到当前标签页');
      const current = await chrome.storage.local.get('captureState');
      if (current.captureState === 'capturing') await stopCapture();
      else await startCapture(tab.id);
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});
