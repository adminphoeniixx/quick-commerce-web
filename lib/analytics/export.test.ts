import { describe,expect,it } from "vitest";
// Regression specification for spreadsheet formula injection. The route applies
// the same leading-character rule to CSV and XLSX cell values.
const safe=(v:unknown)=>{const s=v==null?"":String(v);return /^[=+\-@\t\r]/.test(s)?`'${s}`:s};
describe("analytics export cell safety",()=>{
 it("prefixes formula-like cells",()=>{expect(safe("=cmd()")) .toBe("'=cmd()");expect(safe("+1")) .toBe("'+1");expect(safe("@SUM(A1)")) .toBe("'@SUM(A1)")});
 it("preserves ordinary values and null as blank",()=>{expect(safe("Beverages")).toBe("Beverages");expect(safe(null)).toBe("")});
});
