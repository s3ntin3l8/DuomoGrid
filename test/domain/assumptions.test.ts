import { describe, expect, it } from "vitest";
import { normalizeAssumptions } from "../../src/domain/assumptions.js";
import { DEFAULT_ASSUMPTIONS } from "../../src/domain/types.js";

describe("normalizeAssumptions house upkeep", () => {
  it("fills the defaults for a row saved before these fields existed", () => {
    const old = normalizeAssumptions({ interestPercent: 4 });
    expect(old.interestPercent).toBe(4);
    expect(old.maintenanceEurPerM2Year).toBe(DEFAULT_ASSUMPTIONS.maintenanceEurPerM2Year);
    expect(old.propertyTaxEurYear).toBe(DEFAULT_ASSUMPTIONS.propertyTaxEurYear);
    expect(old.insuranceEurPerM2Year).toBe(DEFAULT_ASSUMPTIONS.insuranceEurPerM2Year);
  });

  it("accepts numbers and numeric strings, and keeps zero", () => {
    const next = normalizeAssumptions({ maintenanceEurPerM2Year: "12.5", propertyTaxEurYear: 0, insuranceEurPerM2Year: 3 });
    expect([next.maintenanceEurPerM2Year, next.propertyTaxEurYear, next.insuranceEurPerM2Year]).toEqual([12.5, 0, 3]);
  });

  it("never lets a cost go negative", () => {
    const next = normalizeAssumptions({ maintenanceEurPerM2Year: -5, propertyTaxEurYear: "-1", insuranceEurPerM2Year: "abc" });
    expect([next.maintenanceEurPerM2Year, next.propertyTaxEurYear, next.insuranceEurPerM2Year]).toEqual([10, 450, 2.5]);
  });
});
