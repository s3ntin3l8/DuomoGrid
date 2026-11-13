import { describe, expect, it } from "vitest";
import { moveLabel, perM2Text, priceMove, priceMoveText } from "../../web/src/format.js";

describe("list price move", () => {
  it("compares the newest observation with the one before it", () => {
    expect(priceMove([{ priceEur: 450000 }, { priceEur: 465000 }])).toBeCloseTo(((450000 - 465000) / 465000) * 100);
    expect(moveLabel(priceMove([{ priceEur: 450000 }, { priceEur: 465000 }]))).toBe("−3%");
    expect(priceMoveText(priceMove([{ priceEur: 103 }, { priceEur: 100 }]))).toBe("price +3%");
  });

  it("rounds the magnitude so a rise and a drop agree", () => {
    expect(moveLabel(0.5)).toBe("+1%");
    expect(moveLabel(-0.5)).toBe("−1%");
    expect(moveLabel(2.5)).toBe("+3%");
    expect(moveLabel(-2.5)).toBe("−3%");
    expect(moveLabel(0.4)).toBeNull();
    expect(moveLabel(-0.4)).toBeNull();
  });

  it("shows nothing when there is no earlier price or the price did not change", () => {
    expect(priceMove([{ priceEur: 100 }])).toBeNull();
    expect(priceMove([{ priceEur: 100 }, { priceEur: null }])).toBeNull();
    expect(priceMove([{ priceEur: null }, { priceEur: 100 }])).toBeNull();
    expect(priceMove([{ priceEur: 100 }, { priceEur: 0 }])).toBeNull();
    expect(priceMove([{ priceEur: 100 }, { priceEur: 100 }])).toBeNull();
    expect(priceMoveText(null)).toBeNull();
    expect(perM2Text(true, null)).toBeNull();
    expect(perM2Text(true, 5054)).toBe("€5,054 / m²");
    expect(perM2Text(false, 12.5)).toBe("€12.50 / m²");
  });
});
