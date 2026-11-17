"use client";
import { apiGet } from "./api";

export interface Overview {
  gmv: number; units: number; avgSellPrice: number | null;
  deltaGmvPct: number | null; deltaUnitsPct: number | null;
  availabilityPct: number | null; oosPct: number | null; sovPct: number | null;
}
export type TrendPoint = { date: string } & Record<string, number | string>;
export interface PlatformRow { platform: string; gmv: number; units: number; share: number; }
export interface SkuRow { skuCode: string; name: string; platform: string; gmv: number; units: number; avgPrice: number | null; }
export interface BrandRow { id: string; name: string; category: string | null; }
export interface CityAvail { city: string; availability: number; }
export interface OosPoint { date: string; oosPct: number; }
export interface PriceRow { skuCode: string; name: string; platform: string; sellingPrice: number; mrp: number | null; discountPct: number | null; }
export interface SovSlice { brand: string; isOwn: boolean; count: number; share: number; }
export interface SovData {
  sovPct: number | null;
  donut: SovSlice[];
  trend: { date: string; sovPct: number }[];
  organicVsSponsored: { organic: number; sponsored: number };
  coverage: { keywords: number; cities: number; platforms: number; observations: number; from: string | null; to: string | null; basis: string };
}
export interface KeywordRow { keyword: string; bestRank: number | null; avgRank: number | null; sovPct: number; observations: number; sponsoredHits: number; }

export interface Params { brandId?: string | null; platform?: string; from?: string; to?: string; }
export interface CategoryRow { category:string;gmv:number|null;units:number|null;availabilityPct:number|null;oosPct:number|null;avgSellingPrice:number|null;sovPct:number|null }
export interface ComparisonValue { current:number|null;previous:number|null;absoluteChange:number|null;percentChange:number|null }
export interface Comparison { currentRange:{from:string;to:string};previousRange:{from:string;to:string};metrics:Record<string,ComparisonValue>;currentTrend:TrendPoint[];previousTrend:TrendPoint[] }

function qs(p: Params): string {
  const u = new URLSearchParams();
  if (p.brandId) u.set("brandId", p.brandId);
  if (p.platform && p.platform !== "ALL") u.set("platform", p.platform);
  if (p.from) u.set("from", p.from);
  if (p.to) u.set("to", p.to);
  const s = u.toString();
  return s ? `?${s}` : "";
}

export const getBrands = () => apiGet<{ brands: BrandRow[] }>("/api/brands").then((d) => d.brands);
export const getOverview = (p: Params) => apiGet<Overview>(`/api/analytics/overview${qs(p)}`);
export const getTrend = (p: Params) => apiGet<{ series: TrendPoint[] }>(`/api/analytics/trend${qs(p)}`).then((d) => d.series);
export const getPlatforms = (p: Params) => apiGet<{ platforms: PlatformRow[] }>(`/api/analytics/platforms${qs(p)}`).then((d) => d.platforms);
export const getSkus = (p: Params) => apiGet<{ skus: SkuRow[] }>(`/api/analytics/skus${qs(p)}`).then((d) => d.skus);
export const getAvailability = (p: Params) => apiGet<{ byCity: CityAvail[]; oosTrend: OosPoint[] }>(`/api/analytics/availability${qs(p)}`);
export const getPricing = (p: Params) => apiGet<{ items: PriceRow[] }>(`/api/analytics/pricing${qs(p)}`).then((d) => d.items);
export const getSov = (p: Params) => apiGet<SovData>(`/api/analytics/sov${qs(p)}`);
export const getKeywords = (p: Params) => apiGet<{ keywords: KeywordRow[] }>(`/api/analytics/keywords${qs(p)}`).then((d) => d.keywords);
export const getCategories = (p: Params) => apiGet<{categories:CategoryRow[]}>(`/api/analytics/categories${qs(p)}`).then(d=>d.categories);
export const getComparison = (p: Params) => apiGet<Comparison>(`/api/analytics/comparison${qs(p)}`);
export const exportUrl = (p: Params, format:"csv"|"xlsx") => `/api/analytics/export${qs(p)}${qs(p)?"&":"?"}format=${format}`;
