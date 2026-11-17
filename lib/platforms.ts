// Platform reference data (names + brand colors). Real constants, not mock analytics.
import type { Platform, PlatformSlug } from "./types";

export const PLATFORMS: Platform[] = [
  { id: 1, name: "Blinkit", slug: "blinkit", color: "var(--blinkit)" },
  { id: 2, name: "Zepto", slug: "zepto", color: "var(--zepto)" },
  { id: 3, name: "Instamart", slug: "instamart", color: "var(--instamart)" },
  { id: 4, name: "BigBasket", slug: "bigbasket", color: "var(--bigbasket)" },
];

export const PLATFORM_BY_SLUG: Record<string, Platform> =
  Object.fromEntries(PLATFORMS.map((p) => [p.slug, p]));

export function platformColor(slug: string): string {
  return PLATFORM_BY_SLUG[slug]?.color ?? "var(--muted)";
}
export function platformName(slug: string): string {
  return PLATFORM_BY_SLUG[slug]?.name ?? slug;
}
export type { PlatformSlug };
