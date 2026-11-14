/**
 * @vitest-environment jsdom
 */
import { act } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  loadSession: vi.fn(),
  loadListings: vi.fn(),
  loadAssumptions: vi.fn(),
  storedToken: vi.fn(() => ""),
  rememberToken: vi.fn(),
}));

vi.mock("../../web/src/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  loadSession: api.loadSession,
  loadListings: api.loadListings,
  loadAssumptions: api.loadAssumptions,
  loadListing: vi.fn(),
  rememberToken: api.rememberToken,
  removeListing: vi.fn(),
  saveAssumptions: vi.fn(),
  saveListing: vi.fn(),
  storedToken: api.storedToken,
}));

import { App } from "../../web/src/App";
import { ApiError } from "../../web/src/api";

describe("desk auth gate", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    api.loadSession.mockReset();
    api.loadListings.mockReset();
    api.loadAssumptions.mockReset();
    api.storedToken.mockReset();
    api.storedToken.mockReturnValue("");
    api.loadListings.mockResolvedValue([]);
    api.loadAssumptions.mockResolvedValue({ assumptions: {}, states: [] });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  async function render() {
    await act(async () => {
      root.render(<App />);
    });
  }

  it("shows no token prompt in proxy mode and loads without a bearer token", async () => {
    api.loadSession.mockResolvedValue({ mode: "proxy" });
    await render();
    await vi.waitFor(() => {
      expect(api.loadListings).toHaveBeenCalledWith("");
    });
    expect(document.body.textContent).not.toContain("Ingest token");
    expect(document.body.textContent).not.toContain("Lock");
  });

  it("shows the token prompt in token mode and does not load yet", async () => {
    api.loadSession.mockResolvedValue({ mode: "token" });
    await render();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Ingest token");
    });
    expect(api.loadListings).not.toHaveBeenCalled();
  });

  it("falls back to the token prompt when the session call fails", async () => {
    api.loadSession.mockRejectedValue(new Error("offline"));
    await render();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Ingest token");
    });
  });

  it("asks for a reload on 401 in proxy mode instead of showing the token prompt", async () => {
    api.loadSession.mockResolvedValue({ mode: "proxy" });
    api.loadListings.mockRejectedValue(new ApiError(401, "Invalid ingest token."));
    await render();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Reload the page");
    });
    expect(document.body.textContent).not.toContain("Ingest token");
  });
});
