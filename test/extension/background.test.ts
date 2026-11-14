import fs from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Seen = (
  listing: unknown,
  api: unknown,
  send: unknown,
  now: () => number,
) => Promise<{ status: string; code?: number }>;
type BackgroundGlobals = typeof globalThis & { duomoHandleSeen: Seen; duomoResetSeen: () => void };

function chromeWith(settings: Record<string, unknown>, session: Record<string, unknown> = {}) {
  return {
    storage: {
      sync: { get: vi.fn(async () => settings) },
      session: {
        get: vi.fn(async (key: string) => (key in session ? { [key]: session[key] } : {})),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(session, values);
        }),
      },
    },
  };
}

const on = { apiUrl: "http://nas.local:3000/", ingestToken: "secret-token", autoUpdate: true };
const listing = { sourceUrl: "https://www.immowelt.de/expose/abc", title: "x", priceEur: 1 };
let clock = 1_000_000;
const now = () => clock;

describe("auto-update in the background worker", () => {
  beforeAll(async () => {
    await import("../../extension/background.js");
  });
  beforeEach(() => {
    (globalThis as BackgroundGlobals).duomoResetSeen();
    clock = 1_000_000;
  });
  const run = (api: unknown, send: unknown) => (globalThis as BackgroundGlobals).duomoHandleSeen(listing, api, send, now);

  it("sends nothing when auto-update is off or the server is not set up", async () => {
    const send = vi.fn();
    expect(await run(chromeWith({ ...on, autoUpdate: false }), send)).toEqual({ status: "off" });
    expect(await run(chromeWith({ ...on, apiUrl: "nas.local" }), send)).toEqual({ status: "not-configured" });
    expect(await run(chromeWith({ ...on, ingestToken: "" }), send)).toEqual({ status: "not-configured" });
    expect(send).not.toHaveBeenCalled();
  });

  it("posts the open listing to the user's own server in update-only mode, with the token", async () => {
    const send = vi.fn(async () => ({ status: 200, ok: true }));
    expect(await run(chromeWith(on), send)).toEqual({ status: "updated" });
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe("http://nas.local:3000/listings?updateOnly=1");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer secret-token");
    expect(JSON.parse(init.body)).toEqual(listing);
  });

  it("reports a listing the server does not have as not saved, and does not retry within the window", async () => {
    const send = vi.fn(async () => ({ status: 204, ok: true }));
    expect(await run(chromeWith(on), send)).toEqual({ status: "not-saved" });
    clock += 5 * 60 * 1000;
    expect(await run(chromeWith(on), send)).toEqual({ status: "throttled" });
    expect(send).toHaveBeenCalledTimes(1);
    clock += 6 * 60 * 1000;
    expect(await run(chromeWith(on), send)).toEqual({ status: "not-saved" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("keeps the throttle across a worker restart, because the timestamps are in session storage", async () => {
    const session: Record<string, unknown> = {};
    const send = vi.fn(async () => ({ status: 200, ok: true }));
    expect(await run(chromeWith(on, session), send)).toEqual({ status: "updated" });
    // Chrome stops an idle worker: memory is gone, session storage is not.
    (globalThis as BackgroundGlobals).duomoResetSeen();
    clock += 2 * 60 * 1000;
    expect(await run(chromeWith(on, session), send)).toEqual({ status: "throttled" });
    expect(send).toHaveBeenCalledTimes(1);
    (globalThis as BackgroundGlobals).duomoResetSeen();
    clock += 9 * 60 * 1000;
    expect(await run(chromeWith(on, session), send)).toEqual({ status: "updated" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends once when the same exposé is opened twice at the same moment", async () => {
    let release: (value: { status: number; ok: boolean }) => void = () => undefined;
    const send = vi.fn(() => new Promise<{ status: number; ok: boolean }>((resolve) => { release = resolve; }));
    const first = run(chromeWith(on), send);
    const second = run(chromeWith(on), send);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release({ status: 200, ok: true });
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.status).sort()).toEqual(["throttled", "updated"]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("forgets a failed send in session storage too, so the next open tries again", async () => {
    const session: Record<string, unknown> = {};
    const down = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await run(chromeWith(on, session), down)).toEqual({ status: "unreachable" });
    (globalThis as BackgroundGlobals).duomoResetSeen();
    const fine = vi.fn(async () => ({ status: 200, ok: true }));
    expect(await run(chromeWith(on, session), fine)).toEqual({ status: "updated" });
  });

  it("lets a failed send try again straight away", async () => {
    const rejected = vi.fn(async () => ({ status: 401, ok: false }));
    expect(await run(chromeWith(on), rejected)).toEqual({ status: "rejected", code: 401 });
    const down = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await run(chromeWith(on), down)).toEqual({ status: "unreachable" });
    const fine = vi.fn(async () => ({ status: 200, ok: true }));
    expect(await run(chromeWith(on), fine)).toEqual({ status: "updated" });
  });

  it("keys the throttle on the portal id, so the same exposé opened from another link is still one", async () => {
    const send = vi.fn(async () => ({ status: 200, ok: true }));
    const api = chromeWith(on);
    const a = { source: "immowelt", externalId: "abc", sourceUrl: "https://www.immowelt.de/expose/abc?from=search" };
    const b = { source: "immowelt", externalId: "abc", sourceUrl: "https://www.immowelt.de/expose/abc?from=map&x=1" };
    const other = { source: "immowelt", externalId: "zzz", sourceUrl: "https://www.immowelt.de/expose/zzz" };
    const seen = (listing: unknown) => (globalThis as BackgroundGlobals).duomoHandleSeen(listing, api, send, now);
    expect((await seen(a)).status).toBe("updated");
    expect((await seen(b)).status).toBe("throttled");
    expect((await seen(other)).status).toBe("updated");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("ignores a listing without a source url", async () => {
    const send = vi.fn();
    const result = await (globalThis as BackgroundGlobals).duomoHandleSeen({ title: "x" }, chromeWith(on), send, now);
    expect(result).toEqual({ status: "skipped" });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("extension wiring for auto-update", () => {
  const read = (file: string) => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), "utf8");

  it("registers the background worker and keeps extract.js before content.js", () => {
    const manifest = JSON.parse(read("manifest.json")) as {
      background: { service_worker: string };
      content_scripts: { js: string[] }[];
    };
    expect(manifest.background.service_worker).toBe("background.js");
    expect(manifest.content_scripts[0]?.js).toEqual(["extract.js", "content.js"]);
  });

  it("reads and sends nothing from the content script unless the option is on", () => {
    const content = read("content.js");
    expect(content).toContain('chrome.storage.sync.get("autoUpdate")');
    const guard = content.indexOf("if (!autoUpdate) return;");
    expect(guard).toBeGreaterThan(-1);
    // The extract call that sends sits after the guard. The earlier one answers the popup's own request.
    expect(content.indexOf("duomoExtract(document", guard)).toBeGreaterThan(guard);
    expect(content.indexOf("sendMessage", guard)).toBeGreaterThan(guard);
  });

  it("stores the option from the popup", () => {
    expect(read("popup.html")).toContain('id="auto"');
    expect(read("popup.js")).toContain("autoUpdate");
  });
});
