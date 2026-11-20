import { describe, expect, it } from "vitest";
import { applyFactor, calibrationFactor, CALIBRATION_MAX, CALIBRATION_MIN, forecastRatio, liftAdjustedDelta, median } from "./growth-learning";

describe("lift-adjusted outcome delta", () => {
  it("scales the before window to the measured days and removes control growth", () => {
    // 3000 over 30 days ⇒ 1500 expected in 15 days; control +10% ⇒ 1650 expected; actual 2000 ⇒ +350.
    expect(liftAdjustedDelta({ beforeSales: 3000, beforeDays: 30, afterSales: 2000, afterDays: 15, controlGrowthPct: 10 })).toBeCloseTo(350);
  });
  it("treats missing control growth as zero", () => {
    expect(liftAdjustedDelta({ beforeSales: 3000, beforeDays: 30, afterSales: 2700, afterDays: 30, controlGrowthPct: null })).toBe(-300);
  });
});

describe("forecast ratio", () => {
  it("uses the high bound for increases and launches", () => {
    expect(forecastRatio("increase", 150, { low: 0, high: 300 })).toBe(0.5);
    expect(forecastRatio("launch", 900, { low: 500, high: 1000 })).toBe(0.9);
  });
  it("uses the negative low bound for decreases", () => {
    expect(forecastRatio("decrease", -100, { low: -400, high: 0 })).toBe(0.25);
  });
  it("is null for a ~0 reference and clipped for outliers", () => {
    expect(forecastRatio("increase", 100, { low: 0, high: 0.5 })).toBeNull();
    expect(forecastRatio("increase", 10_000, { low: 0, high: 100 })).toBe(3);
    expect(forecastRatio("increase", -10_000, { low: 0, high: 100 })).toBe(-3);
  });
});

describe("calibration factor", () => {
  it("has no correction without data", () => {
    expect(calibrationFactor([])).toEqual({ sampleSize: 0, rawRatio: 1, factor: 1 });
  });
  it("shrinks toward 1 with few samples", () => {
    // n=1, median 0.2 ⇒ (0.2 + 5) / 6 ≈ 0.867
    expect(calibrationFactor([0.2]).factor).toBeCloseTo(0.8667, 3);
  });
  it("approaches the observed median as samples grow", () => {
    const c = calibrationFactor(Array(45).fill(0.6));
    expect(c.rawRatio).toBe(0.6);
    expect(c.factor).toBeCloseTo((45 * 0.6 + 5) / 50);
  });
  it("is clamped", () => {
    expect(calibrationFactor(Array(200).fill(-3)).factor).toBe(CALIBRATION_MIN);
    expect(calibrationFactor(Array(200).fill(3)).factor).toBe(CALIBRATION_MAX);
  });
  it("uses the median, so one outlier does not swing it", () => {
    expect(median([0.5, 0.6, 3])).toBe(0.6);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("applies to both bounds", () => {
    expect(applyFactor({ low: -100, high: 200 }, 0.5)).toEqual({ low: -50, high: 100 });
  });
});

import { weightedMedian } from "./growth-learning";
describe("weighted calibration", () => {
  it("weighted median favours heavier samples", () => {
    expect(weightedMedian([{ value: 0.2, weight: 0.5 }, { value: 0.4, weight: 0.5 }, { value: 1, weight: 1 }, { value: 1.2, weight: 0.5 }])).toBe(1);
    expect(weightedMedian([{ value: 1, weight: 1 }, { value: 3, weight: 1 }])).toBe(2);
    expect(weightedMedian([])).toBeNull();
  });
  it("half-weight history shrinks harder than plan outcomes", () => {
    const plan = calibrationFactor(Array(10).fill({ value: 0.5, weight: 1 }));
    const hist = calibrationFactor(Array(10).fill({ value: 0.5, weight: 0.5 }));
    expect(plan.factor).toBeCloseTo((10 * 0.5 + 5) / 15);
    expect(hist.factor).toBeCloseTo((5 * 0.5 + 5) / 10);
    expect(hist.factor).toBeGreaterThan(plan.factor);
  });
});
