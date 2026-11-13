chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "DUOMO_EXTRACT") return;
  try {
    sendResponse(globalThis.duomoExtract(document, location.href));
  } catch (error) {
    sendResponse({ ok: false, reason: error instanceof Error ? error.message : "Could not read this page." });
  }
  return true;
});

/* Opt-in auto-update. Nothing is read or sent unless the user switched it on in the popup. */
(async () => {
  try {
    const { autoUpdate } = await chrome.storage.sync.get("autoUpdate");
    if (!autoUpdate) return;
    const result = globalThis.duomoExtract(document, location.href);
    if (!result?.ok) return;
    await chrome.runtime.sendMessage({ type: "DUOMO_SEEN", listing: result.listing });
  } catch {
    /* the popup still works without this */
  }
})();
