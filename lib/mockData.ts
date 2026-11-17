// Deterministic mock data — stands in for the database (db/schema.sql).
// All figures are illustrative, not real platform numbers.

import type {
  Platform, Brand, Sku, DailyPoint, CityAvailability, SovSlice, Channel, PlatformSlug,
} from "./types";

export const PLATFORMS: Platform[] = [
  { id: 1, name: "Blinkit", slug: "blinkit", color: "var(--blinkit)" },
  { id: 2, name: "Zepto", slug: "zepto", color: "var(--zepto)" },
  { id: 3, name: "Instamart", slug: "instamart", color: "var(--instamart)" },
  { id: 4, name: "BigBasket", slug: "bigbasket", color: "var(--bigbasket)" },
];

export const BRAND: Brand = {
  id: 1301,
  orgName: "Crunchee Foods Pvt Ltd",
  name: "Crunchee Foods",
  category: "Food & Beverages",
  initials: "CF",
};

// seeded PRNG so the dataset is stable across renders
function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const DAYS = 30;
const TODAY = new Date("2026-10-23");

export const DATES: Date[] = Array.from({ length: DAYS }, (_, d) => {
  const dt = new Date(TODAY);
  dt.setDate(TODAY.getDate() - (DAYS - 1 - d));
  return dt;
});

const BASE: Record<PlatformSlug, number> = {
  blinkit: 142000, zepto: 118000, instamart: 96000, bigbasket: 61000,
};

export const DAILY: DailyPoint[] = (() => {
  const rng = makeRng(42);
  return DATES.map((dt, d) => {
    const weekend = dt.getDay() === 0 || dt.getDay() === 6 ? 1.14 : 1.0;
    const trend = 1 + d * 0.004;
    const val = (slug: PlatformSlug) =>
      Math.round(BASE[slug] * trend * weekend * (0.9 + rng() * 0.22));
    return {
      date: dt.toISOString().slice(0, 10),
      blinkit: val("blinkit"),
      zepto: val("zepto"),
      instamart: val("instamart"),
      bigbasket: val("bigbasket"),
    };
  });
})();

export const OOS_TREND: { date: string; pct: number }[] = (() => {
  const rng = makeRng(7);
  return DATES.map((dt, d) => ({
    date: dt.toISOString().slice(0, 10),
    pct: +(10 - d * 0.12 + (rng() * 3 - 1.5)).toFixed(1),
  }));
})();

export const CITIES: CityAvailability[] = [
  { city: "Delhi NCR", availability: 94 },
  { city: "Mumbai", availability: 92 },
  { city: "Bengaluru", availability: 90 },
  { city: "Hyderabad", availability: 88 },
  { city: "Pune", availability: 86 },
  { city: "Chennai", availability: 83 },
];

export const SOV: SovSlice[] = [
  { name: "Crunchee Foods", value: 27.3, isOwn: true },
  { name: "SnackCo", value: 21.0, isOwn: false },
  { name: "CrispWorks", value: 18.0, isOwn: false },
  { name: "NibbleNest", value: 13.0, isOwn: false },
  { name: "ZestUp", value: 20.7, isOwn: false },
];

export const SKUS: Sku[] = (() => {
  const rng = makeRng(99);
  const defs: Omit<Sku, "gmv" | "units" | "availability" | "sov" | "price" | "delta" | "status">[] = [
    { id: 1, name: "Masala Potato Chips 52g", skuCode: "CF-MPC52", emoji: "🥔", channel: "blinkit" },
    { id: 2, name: "Cheese Nachos 150g", skuCode: "CF-CN150", emoji: "🧀", channel: "zepto" },
    { id: 3, name: "Cold Brew Coffee 200ml", skuCode: "CF-CB200", emoji: "☕", channel: "instamart" },
    { id: 4, name: "Dark Choco Cookies 120g", skuCode: "CF-DCC120", emoji: "🍪", channel: "bigbasket" },
    { id: 5, name: "Masala Peanuts 180g", skuCode: "CF-MP180", emoji: "🥜", channel: "blinkit" },
    { id: 6, name: "Aam Panna 250ml", skuCode: "CF-AP250", emoji: "🥭", channel: "zepto" },
    { id: 7, name: "Trail Mix 100g", skuCode: "CF-TM100", emoji: "🌰", channel: "instamart" },
    { id: 8, name: "Sparkling Lemon 330ml", skuCode: "CF-SL330", emoji: "🍋", channel: "blinkit" },
    { id: 9, name: "Choco Hazelnut Spread 350g", skuCode: "CF-CHS350", emoji: "🍫", channel: "bigbasket" },
    { id: 10, name: "Baked Ragi Chips 90g", skuCode: "CF-BRC90", emoji: "🌾", channel: "zepto" },
  ];
  return defs.map((d, i) => {
    const gmv = Math.round((95000 - i * 7200) * (0.85 + rng() * 0.4));
    const availability = Math.round(72 + rng() * 27);
    const status = availability >= 90 ? "ok" : availability >= 78 ? "low" : "oos";
    return {
      ...d,
      gmv,
      units: Math.round(gmv / (70 + rng() * 30)),
      availability,
      sov: +(10 + rng() * 26).toFixed(1),
      price: Math.round(60 + rng() * 130),
      delta: +(rng() * 40 - 14).toFixed(1),
      status,
    };
  });
})();

// ---------- derived selectors (what SQL views would return) ----------

export function totalGmv(ch: Channel): number {
  return DAILY.reduce((sum, d) => {
    if (ch === "ALL") return sum + d.blinkit + d.zepto + d.instamart + d.bigbasket;
    return sum + d[ch];
  }, 0);
}

export function totalUnits(ch: Channel): number {
  return Math.round(totalGmv(ch) / 118);
}

export function platformTotals(): { platform: Platform; gmv: number; share: number }[] {
  const totals = PLATFORMS.map((p) => ({
    platform: p,
    gmv: DAILY.reduce((s, d) => s + d[p.slug], 0),
  }));
  const sum = totals.reduce((s, t) => s + t.gmv, 0);
  return totals
    .map((t) => ({ ...t, share: (t.gmv / sum) * 100 }))
    .sort((a, b) => b.gmv - a.gmv);
}

export const META: Record<Channel, { availability: number; sov: number; oos: number; price: number }> = {
  ALL: { availability: 91.4, sov: 27.3, oos: 6.2, price: 118 },
  blinkit: { availability: 93.8, sov: 31.0, oos: 5.1, price: 112 },
  zepto: { availability: 90.2, sov: 25.4, oos: 7.4, price: 121 },
  instamart: { availability: 88.6, sov: 22.8, oos: 9.1, price: 126 },
  bigbasket: { availability: 92.1, sov: 29.6, oos: 4.3, price: 115 },
};
