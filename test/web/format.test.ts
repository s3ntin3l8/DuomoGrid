import { describe, expect, it } from "vitest";
import { moveLabel, priceMove } from "../../web/src/format.js";

describe("list price move", () => {
  it("compares the newest observation with the one before it", () => {
    expect(priceMove([{ priceEur: 450000 }, { priceEur: 465000 }])).toBeCloseTo(((450000 - 465000) / 465000) * 100);
    expect(moveLabel(priceMove([{ priceEur: 450000 }, { priceEur: 465000 }]))).toBe("−3%");
    expect(moveLabel(priceMove([{ priceEur: 103 }, { priceEur: 100 }]))).toBe("+3%");
  });

  it("shows nothing when there is no earlier price, the price did not change, or the change rounds to zero", () => {
    expect(priceMove([{ priceEur: 100 }])).toBeNull();
    expect(priceMove([{ priceEur: 100 }, { priceEur: null }])).toBeNull();
    expect(priceMove([{ priceEur: null }, { priceEur: 100 }])).toBeNull();
    expect(priceMove([{ priceEur: 100 }, { priceEur: 0 }])).toBeNull();
    expect(priceMove([{ priceEur: 100 }, { priceEur: 100 }])).toBeNull();
    expect(moveLabel(0.4)).toBeNull();
    expect(moveLabel(null)).toBeNull();
  });
});
