/* DuomoGrid: refresh the price of an already saved listing when the user opens its exposé. Opt-in. Reads only the page that is open. */
const THROTTLE_MS = 10 * 60 * 1000;
const STORE_KEY = "duomoSeen";
/** Memory is lost whenever Chrome stops an idle service worker, so storage.session holds the same timestamps. */
const lastSent = new Map();
/** Exposés being sent right now: a reload or a second tab must not start a second send. */
const inFlight = new Set();

async function held(api) {
  const session = api.storage?.session;
  if (!session) return {};
  return (await session.get(STORE_KEY))[STORE_KEY] || {};
}

async function sentRecently(api, key, nowMs) {
  const mem = lastSent.get(key);
  if (mem != null && nowMs - mem < THROTTLE_MS) return true;
  const at = (await held(api))[key];
  if (at != null && nowMs - at < THROTTLE_MS) {
    lastSent.set(key, at);
    return true;
  }
  return false;
}

async function remember(api, key, nowMs) {
  lastSent.set(key, nowMs);
  const session = api.storage?.session;
  if (!session) return;
  const kept = Object.fromEntries(Object.entries(await held(api)).filter(([, at]) => nowMs - at < THROTTLE_MS));
  kept[key] = nowMs;
  await session.set({ [STORE_KEY]: kept });
}

async function forget(api, key) {
  lastSent.delete(key);
  const session = api.storage?.session;
  if (!session) return;
  const { [key]: _gone, ...rest } = await held(api);
  await session.set({ [STORE_KEY]: rest });
}

/**
 * Sends one open exposé to the user's own server, only when the user turned auto-update on. The server treats it as a
 * price check on a listing that is already saved (it answers 204 and stores nothing for an unknown one).
 */
async function handleSeen(listing, api = globalThis.chrome, send = globalThis.fetch, now = () => Date.now()) {
  const settings = await api.storage.sync.get(["apiUrl", "ingestToken", "autoUpdate"]);
  const apiUrl = String(settings.apiUrl || "").trim().replace(/\/$/, "");
  const token = String(settings.ingestToken || "").trim();
  if (!settings.autoUpdate) return { status: "off" };
  if (!/^https?:\/\//.test(apiUrl) || !token) return { status: "not-configured" };
  // The portal's own id identifies the exposé, as it does on the server. The address carries per-visit parameters, so it
  // is only the fallback.
  const key = listing?.source && listing?.externalId ? `${listing.source}:${listing.externalId}` : String(listing?.sourceUrl || "");
  if (!key) return { status: "skipped" };
  if (inFlight.has(key)) return { status: "throttled" };
  inFlight.add(key);
  try {
    if (await sentRecently(api, key, now())) return { status: "throttled" };
    await remember(api, key, now());
    try {
      const response = await send(`${apiUrl}/listings?updateOnly=1`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(listing),
      });
      if (response.status === 204) return { status: "not-saved" };
      if (!response.ok) {
        await forget(api, key);
        return { status: "rejected", code: response.status };
      }
      return { status: "updated" };
    } catch {
      await forget(api, key);
      return { status: "unreachable" };
    }
  } finally {
    inFlight.delete(key);
  }
}

globalThis.duomoHandleSeen = handleSeen;
/** What a worker restart does: memory goes, storage.session stays. */
globalThis.duomoResetSeen = () => {
  lastSent.clear();
  inFlight.clear();
};

if (globalThis.chrome?.runtime?.onMessage) {
  globalThis.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "DUOMO_SEEN") return undefined;
    handleSeen(message.listing).then(sendResponse, () => sendResponse({ status: "error" }));
    return true;
  });
}
