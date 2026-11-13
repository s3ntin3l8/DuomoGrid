import { beforeAll, describe, expect, it } from "vitest";

type ExtractGlobals = typeof globalThis & {
  duomoParseCoordinate: (value: unknown) => number | null;
  duomoJoinStreet: (streetName: unknown, houseNumber: unknown) => string | null;
};

describe("extract helpers", () => {
  beforeAll(async () => {
    await import("../../extension/extract.js");
  });

  it("keeps a coordinate that looks like a German thousand, and does not repeat a house-number token", () => {
    const { duomoParseCoordinate, duomoJoinStreet } = globalThis as ExtractGlobals;
    expect(duomoParseCoordinate("48.137")).toBe(48.137);
    expect(duomoParseCoordinate("12,152")).toBe(12.152);
    expect(duomoJoinStreet("Altstadtstraße 12a", "12")).toBe("Altstadtstraße 12a");
    expect(duomoJoinStreet("Altstadt 12", "12")).toBe("Altstadt 12");
    expect(duomoJoinStreet("Altstadt", "12")).toBe("Altstadt 12");
    expect(duomoJoinStreet("Hauptstraße 112", "12")).toBe("Hauptstraße 112 12");
  });
});
