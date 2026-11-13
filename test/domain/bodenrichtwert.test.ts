import { describe, expect, it } from "vitest";
import { featureInfoUrl, parseBodenrichtwert, parseGermanLandValue } from "../../src/domain/bodenrichtwert.js";

const PUBLISHED = `
Results for FeatureType 'bodenrichtwerte:vboris':
--------------------------------------------
bodenrichtwertszonenname = Untere Altstadt
bodenrichtwertnummer = 26101009
bodenrichtwert = 2.000
stichtag = 01.01.2026
--------------------------------------------
`;

const PAYWALLED = `
--------------------------------------------
bodenrichtwertszonenname = Marienplatz
bodenrichtwertnummer = 3547
bodenrichtwert = Information gebührenpflichtig
stichtag = 01.01.2026
--------------------------------------------
`;

describe("Bodenrichtwert text", () => {
  it("reads a published German-thousands value and keeps the zone name", () => {
    expect(parseBodenrichtwert(PUBLISHED)).toEqual({
      status: "published",
      zone: "Untere Altstadt",
      eurPerM2: 2000,
      stichtag: "01.01.2026",
    });
    expect(parseGermanLandValue("1.680")).toBe(1680);
    expect(parseGermanLandValue("1.100")).toBe(1100);
    expect(parseGermanLandValue("880")).toBe(880);
    expect(parseGermanLandValue("1,3")).toBe(1.3);
    expect(parseGermanLandValue("0,4")).toBe(0.4);
    expect(parseGermanLandValue("2.000,50")).toBe(2000.5);
    expect(parseGermanLandValue("0")).toBeNull();
    expect(parseGermanLandValue("0,0")).toBeNull();
  });

  it("keeps a paywalled zone and does not turn the missing figure into zero", () => {
    expect(parseBodenrichtwert(PAYWALLED)).toEqual({
      status: "unpublished",
      zone: "Marienplatz",
      stichtag: "01.01.2026",
    });
    expect(parseBodenrichtwert("bodenrichtwertszonenname = null\nbodenrichtwertnummer = 12103\nbodenrichtwert = Information gebührenpflichtig\n")).toEqual({
      status: "unpublished",
      zone: "12103",
      stichtag: null,
    });
    expect(parseGermanLandValue("0")).toBeNull();
    expect(parseGermanLandValue("Information gebührenpflichtig")).toBeNull();
    expect(parseBodenrichtwert("bodenrichtwertszonenname = null\nbodenrichtwertnummer = 18\nbodenrichtwert = 570\nstichtag = 01.01.2026\n")).toEqual({
      status: "published",
      zone: "18",
      eurPerM2: 570,
      stichtag: "01.01.2026",
    });
    expect(parseBodenrichtwert("bodenrichtwertszonenname = Acker\nbodenrichtwert = 1,3\nstichtag = 01.01.2026\n")).toEqual({
      status: "published",
      zone: "Acker",
      eurPerM2: 1.3,
      stichtag: "01.01.2026",
    });
  });

  it("treats an empty body as outside the layer", () => {
    expect(parseBodenrichtwert("")).toEqual({ status: "none" });
    expect(parseBodenrichtwert("Results for FeatureType 'bodenrichtwerte:vboris':\n")).toEqual({ status: "none" });
  });

  it("asks WMS 1.3 for EPSG:4326 with latitude first", () => {
    const url = new URL(featureInfoUrl(48.537, 12.152));
    expect(url.origin + url.pathname).toBe("https://gdi.bayern.de/services/bodenrichtwerte/2026/vboris");
    expect(url.searchParams.get("VERSION")).toBe("1.3.0");
    expect(url.searchParams.get("REQUEST")).toBe("GetFeatureInfo");
    expect(url.searchParams.get("LAYERS")).toBe("bodenrichtwerte_2026");
    expect(url.searchParams.get("INFO_FORMAT")).toBe("text/plain");
    expect(url.searchParams.get("CRS")).toBe("EPSG:4326");
    const bbox = (url.searchParams.get("BBOX") ?? "").split(",").map(Number);
    expect(bbox[0]).toBeLessThan(48.537);
    expect(bbox[1]).toBeLessThan(12.152);
    expect(bbox[2]).toBeGreaterThan(48.537);
    expect(bbox[3]).toBeGreaterThan(12.152);
  });
});
