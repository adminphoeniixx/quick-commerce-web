import { describe, expect, it } from "vitest";
import { applyMapping, suggestMapping, validateMapping, validationSummary } from "./mapping";
describe("advanced import mapping", () => {
  it("detects normalized aliases without guessing unknown columns", () => { expect(suggestMapping([" SKU_CODE ", "Revenue", "mystery"], "sales").map(x => x.target)).toEqual(["skuCode", "gmv", null]); });
  it("rejects missing fields and duplicate targets", () => { expect(validateMapping({ SKU: "skuCode", Product: "skuCode" }, "sales")[0]).toContain("mapped more than once"); expect(validateMapping({ SKU: "skuCode" }, "sales").length).toBeGreaterThan(0); });
  it("applies manual mappings with production validation", () => { const mapping = { Code: "skuCode", Day: "date", Amount: "gmv", Qty: "units" }; const source = [{ Code: "A", Day: "2026-10-01", Amount: "25", Qty: "2" }]; expect(applyMapping(source, mapping, "sales")[0]).toMatchObject({ "SKU Code": "A", GMV: "25" }); expect(validationSummary(source, mapping, "sales", "blinkit")).toMatchObject({ total: 1, valid: 1, invalid: 0 }); });
  it("leaves unrelated headers unmapped", () => { expect(suggestMapping(["Product"], "pricing")[0].target).toBeNull(); });
});
