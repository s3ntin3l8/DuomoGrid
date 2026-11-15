import { afterEach, describe, expect, it, vi } from "vitest";
import { pairFromPage } from "../../extension/pair.js";

describe("desk pairing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs the stringified function and sends the stored token only in token mode", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/auth/session") return new Response(JSON.stringify({ mode: "proxy" }), { status: 200 });
      return new Response(JSON.stringify({ ingestToken: "from-server" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", { getItem: () => "leftover-token" });

    // executeScript runs this source in the page, with no module scope.
    const injected = Function(`return (${pairFromPage.toString()})`)() as typeof pairFromPage;
    await expect(injected()).resolves.toEqual({ ok: true, ingestToken: "from-server" });
    expect(fetchMock.mock.calls.find((call) => call[0] === "/auth/pair")?.[1]).toMatchObject({
      method: "POST",
      headers: {},
    });

    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/auth/session") return new Response(JSON.stringify({ mode: "token" }), { status: 200 });
      return new Response(JSON.stringify({ ingestToken: "from-server" }), { status: 200 });
    });
    await injected();
    expect(fetchMock.mock.calls.filter((call) => call[0] === "/auth/pair").at(-1)?.[1]).toMatchObject({
      headers: { authorization: "Bearer leftover-token" },
    });
  });
});
