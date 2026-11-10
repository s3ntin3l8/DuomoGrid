chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "DUOMO_EXTRACT") return;
  try {
    sendResponse(globalThis.duomoExtract(document, location.href));
  } catch (error) {
    sendResponse({ ok: false, reason: error instanceof Error ? error.message : "Could not read this page." });
  }
  return true;
});
