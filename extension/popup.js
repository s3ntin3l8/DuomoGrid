let current = null;

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

async function init() {
  const stored = await chrome.storage.sync.get(["apiUrl", "ingestToken", "autoUpdate"]);
  document.querySelector("#auto").checked = Boolean(stored.autoUpdate);
  document.querySelector("#url").value = stored.apiUrl || "http://127.0.0.1:3000";
  document.querySelector("#token").value = stored.ingestToken || "";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    showStatus("No active tab.");
    return;
  }
  try {
    const response = await readTab(tab.id);
    if (!response?.ok) {
      showStatus(response?.reason || "This is not a single listing.");
      return;
    }
    render(response.listing);
  } catch {
    showStatus("This page cannot be read. Open one listing on ImmoScout24 or Immowelt.");
  }
}

async function remember() {
  const apiUrl = document.querySelector("#url").value.trim().replace(/\/$/, "");
  const ingestToken = document.querySelector("#token").value.trim();
  await chrome.storage.sync.set({ apiUrl, ingestToken });
  return { apiUrl, ingestToken };
}

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

void init();
