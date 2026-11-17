import { describe, it, expect } from "vitest";
import { getAvailabilityAdapter, getPricingAdapter, getVisibilityAdapter } from "./index";

describe("availability adapter", () => {
  const a = getAvailabilityAdapter("blinkit");

  it("parses quantitative store counts", () => {
    const { rows, errors } = a.parse([
      { "SKU Code": "CF-A", "City": "Mumbai", "Date": "2026-10-01", "Stores Total": "10", "Stores In Stock": "7" },
    ]);
    expect(errors).toHaveLength(0);
    expect(rows[0]).toMatchObject({ skuCode: "CF-A", cityName: "Mumbai", storesTotal: 10, storesInStock: 7 });
  });

  it("parses binary availability without fabricating quantities", () => {
    const { rows } = a.parse([
      { "SKU Code": "CF-A", "City": "Pune", "Date": "2026-10-01", "Availability": "no" },
      { "SKU Code": "CF-B", "City": "Pune", "Date": "2026-10-01", "Availability": "yes" },
    ]);
    expect(rows[0]).toMatchObject({ storesTotal: 1, storesInStock: 0 });
    expect(rows[1]).toMatchObject({ storesTotal: 1, storesInStock: 1 });
  });

  it("flags missing city and out-of-range counts", () => {
    const { errors } = a.parse([
      { "SKU Code": "CF-A", "City": "", "Date": "2026-10-01", "Availability": "yes" },
      { "SKU Code": "CF-A", "City": "X", "Date": "2026-10-01", "Stores Total": "5", "Stores In Stock": "9" },
    ]);
    expect(errors).toHaveLength(2);
  });
});

describe("pricing adapter", () => {
  const p = getPricingAdapter("blinkit");

  it("computes discount from MRP and selling price", () => {
    const { rows } = p.parse([{ "SKU Code": "CF-A", "Date": "2026-10-01", "MRP": "100", "Selling Price": "80" }]);
    expect(rows[0]).toMatchObject({ sellingPrice: 80, mrp: 100, discountPct: 20, cityName: "National" });
  });

  it("rejects MRP lower than selling price and missing price", () => {
    const { rows, errors } = p.parse([
      { "SKU Code": "CF-A", "Date": "2026-10-01", "MRP": "50", "Selling Price": "80" },
      { "SKU Code": "CF-B", "Date": "2026-10-01", "Selling Price": "" },
    ]);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(2);
  });
});

describe("visibility adapter", () => {
  const v = getVisibilityAdapter("blinkit");

  it("parses rank observations with sponsored flag", () => {
    const { rows, errors } = v.parse([
      { "Keyword": "chips", "Date": "2026-10-01", "Brand": "Crunchee", "Rank": "2", "Sponsored": "yes" },
      { "Keyword": "chips", "City": "Mumbai", "Date": "2026-10-01", "Brand": "RivalCo", "Rank": "1" },
    ]);
    expect(errors).toHaveLength(0);
    expect(rows[0]).toMatchObject({ keyword: "chips", observedBrand: "Crunchee", rank: 2, isSponsored: true, cityName: "National" });
    expect(rows[1]).toMatchObject({ cityName: "Mumbai", rank: 1, isSponsored: false });
  });

  it("rejects missing keyword / brand / rank", () => {
    const { rows, errors } = v.parse([
      { "Keyword": "", "Date": "2026-10-01", "Brand": "X", "Rank": "1" },
      { "Keyword": "k", "Date": "2026-10-01", "Brand": "", "Rank": "1" },
      { "Keyword": "k", "Date": "2026-10-01", "Brand": "X", "Rank": "0" },
    ]);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(3);
  });
});
