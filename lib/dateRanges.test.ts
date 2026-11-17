import { describe, expect, it } from "vitest";
import { previousRange, rangeForPreset } from "./dateRanges";
const available = { from: "2026-01-01", to: "2026-11-04" };
describe("date range presets", () => {
  it("builds inclusive rolling periods", () => expect(rangeForPreset("last-7", available.to, available)).toEqual({ from: "2026-10-29", to: "2026-11-04" }));
  it("uses Monday for week boundaries", () => expect(rangeForPreset("this-week", available.to, available)).toEqual({ from: "2026-11-02", to: "2026-11-04" }));
  it("handles the prior month", () => expect(rangeForPreset("last-month", available.to, available)).toEqual({ from: "2026-10-01", to: "2026-10-31" }));
  it("creates an equally sized previous period", () => expect(previousRange({ from: "2026-10-29", to: "2026-11-04" })).toEqual({ from: "2026-10-22", to: "2026-10-28" }));
});
