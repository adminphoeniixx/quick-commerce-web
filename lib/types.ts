// Domain types — mirror the PostgreSQL schema in db/schema.sql

export type PlatformSlug = "blinkit" | "zepto" | "instamart" | "bigbasket";

export interface Platform {
  id: number;
  name: string;
  slug: PlatformSlug;
  color: string; // CSS var reference, resolved at render
}

export interface Brand {
  id: number;
  orgName: string;
  name: string;
  category: string;
  initials: string;
}

export type StockStatus = "ok" | "low" | "oos";

export interface Sku {
  id: number;
  name: string;
  skuCode: string;
  emoji: string;
  channel: PlatformSlug;
  gmv: number;
  units: number;
  availability: number; // %
  sov: number; // %
  price: number; // INR
  delta: number; // % vs prev period
  status: StockStatus;
}

export interface DailyPoint {
  date: string; // ISO
  blinkit: number;
  zepto: number;
  instamart: number;
  bigbasket: number;
}

export interface CityAvailability {
  city: string;
  availability: number;
}

export interface SovSlice {
  name: string;
  value: number;
  isOwn: boolean;
}

export type Channel = PlatformSlug | "ALL";

export interface Kpi {
  key: string;
  label: string;
  value: string;
  unit?: string;
  delta: number;
  up: boolean;
  lowerIsBetter?: boolean;
  sub: string;
}
