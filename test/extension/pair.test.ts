import { afterEach, describe, expect, it, vi } from "vitest";
import { pairFromPage, pairHeaders } from "../../extension/pair.js";

describe("desk pairing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the stored token only in token mode", () => {
    expect(pairHeaders("token", "test-token")).toEqual({ authorization: "Bearer test-token" });
    expect(pairHeaders("proxy", "leftover-token")).toEqual({});
    expect(pairHeaders("token", "")).toEqual({});
  });

  it("asks the session before posting, and does not send a leftover token in proxy mode", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/auth/session") return new Response(JSON.stringify({ mode: "proxy" }), { status: 200 });
      return new Response(JSON.stringify({ ingestToken: "from-server" }), { status: init?.headers ? 200 : 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", { getItem: () => "leftover-token" });

    await expect(pairFromPage()).resolves.toEqual({ ok: true, ingestToken: "from-server" });
    expect(fetchMock).toHaveBeenCalledWith("/auth/pair", { method: "POST", headers: {} });
  });
});
