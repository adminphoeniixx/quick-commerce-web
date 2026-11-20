import { describe, expect, it } from "vitest";
import { campaignLaunchForecast, detectCpmChangePoints, evaluateBidEvent, windowSum, type DayPoint } from "./growth-history";

const day = (i: number) => new Date(Date.UTC(2026, 8, 1) + i * 86_400_000).toISOString().slice(0, 10);
// cpm = spend / impressions × 1000; 1000 impressions/day ⇒ spend equals CPM.
const series = (cpms: number[], sales = 100): DayPoint[] => cpms.map((cpm, i) => ({ date: day(i), spend: cpm, impressions: 1000, sales }));

describe("CPM change-point detection", () => {
  it("detects a sustained step up and reports one event", () => {
    const cps = detectCpmChangePoints(series([100, 101, 99, 100, 100, 120, 121, 119, 120, 120, 121]));
    expect(cps).toHaveLength(1);
    expect(cps[0].date).toBe(day(5));
    expect(cps[0].changePct).toBeCloseTo(20, 0);
  });
  it("detects a step down", () => {
    const cps = detectCpmChangePoints(series([200, 200, 200, 170, 168, 171, 170]));
    expect(cps[0].changePct).toBeLessThan(-8);
  });
  it("ignores noise and one-day spikes", () => {
    expect(detectCpmChangePoints(series([100, 104, 97, 103, 98, 130, 101, 99, 102, 100]))).toEqual([]);
  });
  it("ignores low-impression days", () => {
    const s = series([100, 100, 100, 150, 150, 150]).map((d, i) => (i >= 3 ? { ...d, impressions: 50, spend: 7.5 } : d));
    expect(detectCpmChangePoints(s)).toEqual([]);
  });
});

describe("bid event evaluation", () => {
  // 28 days: 14 before at 100/day sales, 14 after at 130/day; spend 50/day.
  const s: DayPoint[] = Array.from({ length: 28 }, (_, i) => ({ date: day(i), spend: 50, impressions: 1000, sales: i < 14 ? 100 : 130 }));
  it("lift-adjusts by control growth and compares to the bounded forecast", () => {
    const r = evaluateBidEvent({ series: s, control: { before: 10_000, after: 11_000 }, date: day(14), changePct: 10, lastDate: day(27) })!;
    expect(r.direction).toBe("increase");
    expect(r.before.sales).toBe(1400);
    expect(r.after.sales).toBe(1820);
    expect(r.controlGrowthPct).toBeCloseTo(10);
    expect(r.salesDelta).toBeCloseTo(1820 - 1400 * 1.1); // 280
    expect(r.forecast).toEqual({ low: 0, high: 140 }); // 10% of 1400
    expect(r.forecastRatio).toBeCloseTo(2);
  });
  it("waits until the after-window is complete", () => {
    expect(evaluateBidEvent({ series: s, control: { before: 1, after: 1 }, date: day(14), changePct: 10, lastDate: day(26) })).toBeNull();
  });
  it("needs minimum spend in both windows", () => {
    const thin = s.map((d) => ({ ...d, spend: 10 }));
    expect(evaluateBidEvent({ series: thin, control: { before: 1, after: 1 }, date: day(14), changePct: 10, lastDate: day(27) })).toBeNull();
  });
  it("sums windows inclusively", () => {
    expect(windowSum(s, day(0), day(1))).toEqual({ sales: 200, spend: 100, days: 2 });
  });
});

describe("campaign launch forecast replay", () => {
  it("caps the high bound at the observed ROAS", () => {
    const ref = [{ spend: 100, sales: 200 }, { spend: 100, sales: 400 }, { spend: 100, sales: 300 }, { spend: 0, sales: 50 }];
    const f = campaignLaunchForecast(ref, 1000); // observed ROAS 3, p75 3.5 ⇒ high 3; p25 2.5 vs 0.6×3=1.8 ⇒ low 1.8
    expect(f.high).toBeCloseTo(3000);
    expect(f.low).toBeCloseTo(1800);
  });
});
