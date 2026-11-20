import { describe, expect, it } from "vitest";
import { confidenceFor, insightFromDays, summarizeSearchDay, theilSen, type MarketDay } from "./market-learning";
import { staleKeywords } from "./web-research";
import { searchAllowed } from "@/lib/seo/search-budget";

describe("Theil–Sen slope", () => {
  it("recovers a clean line and ignores an outlier", () => {
    const pts = [1, 2, 3, 4, 5, 6].map((x) => ({ x, y: 100 - 10 * x }));
    expect(theilSen(pts)).toBe(-10);
    expect(theilSen([...pts, { x: 7, y: 500 }])).toBe(-10);
  });
  it("needs at least 3 distinct x values", () => {
    expect(theilSen([{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 3 }])).toBeNull();
  });
});

describe("confidence", () => {
  it("is insufficient below 10 days", () => {
    expect(confidenceFor(9)).toBe("insufficient");
    expect(confidenceFor(10)).toBe("low");
    expect(confidenceFor(15)).toBe("medium");
    expect(confidenceFor(30)).toBe("high");
  });
});

describe("keyword insight", () => {
  const day = (i: number): MarketDay => ({ sales: 1000 - 50 * (i % 5), organicRank: 1 + (i % 5), priceGapPct: (i % 4) * 5, competitorSoldOutShare: i % 3 === 0 ? 0.3 : 0, adShareTop10: 0.4 });
  it("expresses sensitivities as % of mean daily sales", () => {
    const r = insightFromDays(Array.from({ length: 20 }, (_, i) => day(i)));
    expect(r.confidence).toBe("medium");
    expect(r.meanDailySales).toBe(900);
    expect(r.rankSensitivityPct).toBeCloseTo((-50 / 900) * 100, 1); // −5.6% per position worse
    expect(r.avgOrganicRank).toBe(3);
    expect(r.adShareTop10).toBe(0.4);
    expect(r.stockoutUpliftPct).not.toBeNull();
  });
  it("learns nothing from too few days", () => {
    const r = insightFromDays(Array.from({ length: 5 }, (_, i) => day(i)));
    expect(r.confidence).toBe("insufficient");
    expect(r.rankSensitivityPct).toBeNull();
  });
});

describe("search day summary", () => {
  it("derives own rank, price gap, competitor stock-outs and ad share", () => {
    const s = summarizeSearchDay([
      { rank: 1, organicRank: null, price: 50, isOwn: false, isAd: true, soldOut: false },
      { rank: 2, organicRank: 1, price: 100, isOwn: false, isAd: false, soldOut: true },
      { rank: 3, organicRank: 2, price: 110, isOwn: true, isAd: false, soldOut: false },
      { rank: 4, organicRank: 3, price: 100, isOwn: false, isAd: false, soldOut: false },
    ]);
    expect(s.organicRank).toBe(2);
    expect(s.priceGapPct).toBeCloseTo(10); // 110 vs competitor median 100
    expect(s.competitorSoldOutShare).toBeCloseTo(1 / 3);
    expect(s.adShareTop10).toBe(0.25);
  });
});

describe("web data gaps", () => {
  it("returns missing and stale keywords, stalest first", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    const latest = new Map([["chips", new Date("2026-11-19T06:00:00Z")], ["soda", new Date("2026-11-10T06:00:00Z")]]);
    expect(staleKeywords(["chips", "soda", "namkeen"], latest, now, 3)).toEqual(["namkeen", "soda"]);
  });
});

describe("shared search budget", () => {
  it("manual runs use the full limits", () => {
    expect(searchAllowed({ location: "Sector 50 Gurugram", runsToday: { Gurugram: 1 } }).ok).toBe(true);
    expect(searchAllowed({ location: "Sector 50 Gurugram", runsToday: { Gurugram: 2 } }).ok).toBe(false);
    expect(searchAllowed({ location: "Andheri Mumbai", runsToday: { Gurugram: 2, Delhi: 2, Pune: 2 } }).ok).toBe(false);
  });
  it("agents never take the last run and run at most once a day", () => {
    expect(searchAllowed({ location: "Sector 50 Gurugram", runsToday: {}, reserve: 1, agentRunsToday: 0 }).ok).toBe(true);
    expect(searchAllowed({ location: "Sector 50 Gurugram", runsToday: { Gurugram: 1 }, reserve: 1, agentRunsToday: 0 }).ok).toBe(false);
    expect(searchAllowed({ location: "Sector 50 Gurgaon", runsToday: { Gurugram: 1 }, reserve: 1, agentRunsToday: 0 }).ok).toBe(false);
    expect(searchAllowed({ location: "Andheri Mumbai", runsToday: { Gurugram: 2, Delhi: 2, Pune: 1 }, reserve: 1, agentRunsToday: 0 }).ok).toBe(false);
    expect(searchAllowed({ location: "Andheri Mumbai", runsToday: {}, reserve: 1, agentRunsToday: 1 }).ok).toBe(false);
  });
});
