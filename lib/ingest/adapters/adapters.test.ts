import { describe, it, expect } from "vitest";
import { getAdapter } from "./index";

describe("blinkit sales adapter", () => {
  const adapter = getAdapter("blinkit");

  it("normalizes valid rows", () => {
    const { rows, errors } = adapter.parse([
      { "SKU Code": "CF-1", "Date": "2026-10-01", "GMV": "₹1,200", "Units Sold": "10", "ASP": "120" },
      { "SKU Code": "CF-2", "Date": "02/10/2026", "GMV": "800", "Units Sold": "8" },
    ]);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ skuCode: "CF-1", date: "2026-10-01", gmv: 1200, unitsSold: 10, avgSellPrice: 120 });
    expect(rows[1].date).toBe("2026-10-02"); // DD/MM/YYYY parsed
  });

  it("flags missing/invalid fields with row numbers", () => {
    const { rows, errors } = adapter.parse([
      { "SKU Code": "", "Date": "2026-10-01", "GMV": "100", "Units Sold": "1" },      // missing sku
      { "SKU Code": "CF-3", "Date": "not-a-date", "GMV": "100", "Units Sold": "1" },  // bad date
      { "SKU Code": "CF-4", "Date": "2026-10-01", "GMV": "abc", "Units Sold": "1" },  // bad gmv
    ]);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(3);
    expect(errors[0].row).toBe(2); // first data row = line 2 (after header)
    expect(errors[1].message).toMatch(/date/i);
  });

  it("rejects negative values", () => {
    const { errors } = adapter.parse([{ "SKU Code": "X", "Date": "2026-10-01", "GMV": "-5", "Units Sold": "1" }]);
    expect(errors[0].message).toMatch(/negative/i);
  });
});

describe("all four platform adapters exist with required columns", () => {
  for (const slug of ["blinkit", "zepto", "instamart", "bigbasket"] as const) {
    it(`${slug} adapter`, () => {
      const a = getAdapter(slug);
      expect(a.platform).toBe(slug);
      expect(a.requiredColumns.length).toBeGreaterThanOrEqual(4);
    });
  }
});
