import { isNewer, updateLink } from "./update.js";

let current = null;
const RELEASES = "https://api.github.com/repos/s3ntin3l8/DuomoGrid/releases/latest";
const UPDATE_TTL_MS = 60 * 60 * 1000;

function money(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}

function showStatus(text) {
  const node = document.querySelector("#status");
  node.hidden = !text;
  node.textContent = text || "";
}

function render(listing) {
  current = listing;
  document.querySelector("#card").hidden = false;
  document.querySelector("#title").textContent = listing.title || "Listing";
  const place = [listing.district, listing.city].filter(Boolean).join(", ");
  document.querySelector("#meta").textContent = place || listing.source;
  document.querySelector("#price").textContent = money(listing.priceEur);
  document.querySelector("#area").textContent = listing.livingAreaM2 ? `${listing.livingAreaM2} m2` : "—";
  document.querySelector("#energy").textContent = listing.energyClass || "—";
  document.querySelector("#send").disabled = false;
  document.querySelector("#copy").disabled = false;
  const gaps = [];
  if (listing.priceEur == null) gaps.push("price");
  if (listing.livingAreaM2 == null) gaps.push("area");
  if (!listing.energyClass && listing.energyKwh == null) gaps.push("energy");
  showStatus(gaps.length ? `Not detected: ${gaps.join(", ")}.` : "");
}

async function readTab(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "DUOMO_EXTRACT" });
    if (response) return response;
  } catch {
    /* content script not injected yet */
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ["extract.js"] });
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.duomoExtract(document, location.href),
  });
  return injected?.result;
}

function showPaired(apiUrl) {
  const node = document.querySelector("#paired");
  const manual = document.querySelector("#manual");
  if (!apiUrl) {
    node.hidden = true;
    manual.open = true;
    return;
  }
  node.hidden = false;
  node.textContent = `Paired with ${apiUrl}`;
  manual.open = false;
}

/** Runs in the desk page, so the Authentik cookie and the desk's stored token are available. */
async function pairFromPage() {
  const token = localStorage.getItem("duomo.token") || "";
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch("/auth/pair", { method: "POST", headers });
  if (!response.ok) return { ok: false, status: response.status };
  const body = await response.json();
  const apiUrl = String(body.apiUrl ?? "").replace(/\/$/, "");
  const ingestToken = String(body.ingestToken ?? "");
  if (!apiUrl || !ingestToken) return { ok: false, status: response.status };
  return { ok: true, apiUrl, ingestToken };
}

async function init() {
  const stored = await chrome.storage.sync.get(["apiUrl", "ingestToken", "autoUpdate"]);
  document.querySelector("#auto").checked = Boolean(stored.autoUpdate);
  document.querySelector("#url").value = stored.apiUrl || "http://127.0.0.1:3000";
  document.querySelector("#token").value = stored.ingestToken || "";
  showPaired(stored.apiUrl && stored.ingestToken ? stored.apiUrl : "");
  void noticeUpdate();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    showStatus("No active tab.");
    return;
  }
  const expose = /immobilienscout24\.de\/expose\/|immowelt\.de\/expose\//.test(tab.url ?? "");
  try {
    const response = await readTab(tab.id);
    if (!response?.ok) {
      if (expose) showStatus(response?.reason || "This is not a single listing.");
      return;
    }
    render(response.listing);
  } catch {
    if (expose) showStatus("This page cannot be read. Open one listing on ImmoScout24 or Immowelt.");
  }
}

async function remember() {
  const apiUrl = document.querySelector("#url").value.trim().replace(/\/$/, "");
  const ingestToken = document.querySelector("#token").value.trim();
  await chrome.storage.sync.set({ apiUrl, ingestToken });
  showPaired(apiUrl && ingestToken ? apiUrl : "");
  return { apiUrl, ingestToken };
}

document.querySelector("#pair").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:\/\//.test(tab.url ?? "")) {
    showStatus("Open the desk, then pair.");
    return;
  }
  try {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: pairFromPage,
    });
    const paired = injected?.result;
    if (!paired?.ok) {
      showStatus("Open the desk and sign in, then pair. The server did not hand over a token.");
      return;
    }
    await chrome.storage.sync.set({ apiUrl: paired.apiUrl, ingestToken: paired.ingestToken });
    document.querySelector("#url").value = paired.apiUrl;
    document.querySelector("#token").value = paired.ingestToken;
    showPaired(paired.apiUrl);
    showStatus("Paired.");
  } catch {
    showStatus("Open the desk, then pair.");
  }
});

document.querySelector("#auto").addEventListener("change", (event) => {
  void chrome.storage.sync.set({ autoUpdate: event.target.checked });
});
document.querySelector("#url").addEventListener("change", () => {
  void remember();
});
document.querySelector("#token").addEventListener("change", () => {
  void remember();
});

document.querySelector("#send").addEventListener("click", async () => {
  if (!current) return;
  const { apiUrl, ingestToken } = await remember();
  if (!/^https?:\/\//.test(apiUrl)) {
    showStatus("Enter the server URL, including http:// or https://.");
    return;
  }
  if (!ingestToken) {
    showStatus("Enter the ingest token from the server.");
    return;
  }
  try {
    const response = await fetch(`${apiUrl}/listings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ingestToken}` },
      body: JSON.stringify(current),
    });
    if (!response.ok) {
      showStatus(`The server rejected the listing (${response.status}).`);
      return;
    }
    const body = await response.json();
    showStatus(body.created ? "Saved." : "Updated the existing listing.");
  } catch {
    showStatus("Could not reach the server.");
  }
});

document.querySelector("#copy").addEventListener("click", async () => {
  if (!current) return;
  await navigator.clipboard.writeText(JSON.stringify(current, null, 2));
  showStatus("JSON copied.");
});

async function noticeUpdate() {
  const currentVersion = chrome.runtime.getManifest().version;
  const cached = await chrome.storage.session.get("updateCheck");
  let release = cached.updateCheck;
  if (!release || Date.now() - release.checkedAt > UPDATE_TTL_MS) {
    try {
      const response = await fetch(RELEASES, { headers: { accept: "application/vnd.github+json" } });
      if (!response.ok) return;
      const body = await response.json();
      release = {
        checkedAt: Date.now(),
        tag: body.tag_name,
        html_url: body.html_url,
        assets: body.assets,
      };
      await chrome.storage.session.set({ updateCheck: release });
    } catch {
      return;
    }
  }
  const latest = String(release.tag ?? "").replace(/^v/, "");
  if (!isNewer(latest, currentVersion)) return;
  const link = document.querySelector("#update");
  link.href = updateLink(release, latest);
  link.textContent = `Version ${latest} is out. Replace the files in this folder, then click Reload.`;
  link.hidden = false;
}

void init();
