import { describe, expect, it } from "vitest";
import { isNewer, updateLink } from "../../extension/update.js";

describe("extension update notice", () => {
  it("notices only a newer dotted version", () => {
    expect(isNewer("0.1.6", "0.1.5")).toBe(true);
    expect(isNewer("v0.2.0", "0.1.9")).toBe(true);
    expect(isNewer("0.1.5", "0.1.5")).toBe(false);
    expect(isNewer("0.1.4", "0.1.5")).toBe(false);
    expect(isNewer("nightly", "0.1.5")).toBe(false);
  });

  it("links the release zip when the asset is there", () => {
    const release = {
      html_url: "https://github.com/s3ntin3l8/DuomoGrid/releases/tag/v0.1.6",
      assets: [{ name: "duomogrid-extension-0.1.6.zip", browser_download_url: "https://example.test/ext.zip" }],
    };
    expect(updateLink(release, "0.1.6")).toBe("https://example.test/ext.zip");
    expect(updateLink({ html_url: release.html_url, assets: [] }, "0.1.6")).toBe(release.html_url);
  });
});
