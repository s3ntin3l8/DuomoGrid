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

  it("asks the session before posting, and the stringified function does not send a leftover token", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/auth/session") return new Response(JSON.stringify({ mode: "proxy" }), { status: 200 });
      return new Response(JSON.stringify({ ingestToken: "from-server" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", { getItem: () => "leftover-token" });

    // executeScript runs this source in the page, with no module scope.
    const injected = Function(`return (${pairFromPage.toString()})`)() as typeof pairFromPage;
    expect(pairFromPage.toString()).not.toContain("pairHeaders");
    await expect(injected()).resolves.toEqual({ ok: true, ingestToken: "from-server" });
    const posted = fetchMock.mock.calls.find((call) => call[0] === "/auth/pair");
    expect(posted?.[1]).toMatchObject({ method: "POST", headers: {} });
  });
});
