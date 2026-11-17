// Default period for the ads APIs: explicit ?from&to, else the last 30 synced days.
import { dateRange } from "@/lib/channels/queries";
import { adsMeta, type AdsScope, type Range } from "@/lib/ads/queries";

export async function adsRange(s: AdsScope): Promise<Range | null> {
  const explicit = dateRange(s.url);
  if (explicit) return explicit;
  const meta = await adsMeta(s);
  if (!meta.from || !meta.to) return null;
  const to = new Date(`${meta.to}T00:00:00.000Z`);
  const from = new Date(Math.max(new Date(`${meta.from}T00:00:00.000Z`).getTime(), to.getTime() - 29 * 86400_000));
  return { from, to };
}
