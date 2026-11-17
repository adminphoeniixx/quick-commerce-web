// Loads a Blinkit Seller Hub listing / SEO payload (services/browser/blinkit_seller_seo.py)
// into ListingSeoSnapshot: one row per product per IST day, replaced on re-sync.
// Rule-based issues are computed here so the page and any export see the same list.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type J = Record<string, unknown>;
export interface SeoCtx { orgId: bigint; brandId: bigint; platformId: number }
export interface Issue { severity: "high" | "medium" | "low"; code: string; message: string }

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/[₹,\s%]/g, ""));
    return v.trim() && Number.isFinite(n) ? n : null;
  }
  return null;
};
const int = (v: unknown) => { const n = num(v); return n == null ? null : Math.round(n); };
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : Array.isArray(v) ? v.filter(Boolean).join(", ") : String(v));
const filled = (v: unknown) => { const s = str(v).trim(); return !!s && !/^(na|n\/a|null|none|-)$/i.test(s); };
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

const MIN_DESCRIPTION = 150;
const MIN_IMAGES = 5;
const fmt = (n: number | null | undefined, d = 1) => (n == null ? "–" : Number(n.toFixed(d)).toString());

export function listingIssues(r: {
  availabilityPct: number | null; availabilityTarget: number | null; storesLive: number | null; storesClosed: number | null;
  unitsPerStoreDay: number | null; unitsTarget: number | null; salesPerStoreDay: number | null; salesTarget: number | null;
  complaintPct: number | null; complaintTarget: number | null; descriptionLength: number; imageCount: number;
  missing: { name: string; mandatory: boolean }[]; units: number | null; expansionLevel: string | null; assessmentEnd: Date | null;
}): Issue[] {
  const out: Issue[] = [];
  if (r.expansionLevel && /discontinu|delist/i.test(r.expansionLevel))
    return [{ severity: "low", code: "discontinued", message: `Listing is ${r.expansionLevel.toLowerCase()}: relaunch it from Seller Hub or ignore.` }];
  const assessmentOpen = r.assessmentEnd && r.assessmentEnd.getTime() >= Date.now() - 86400_000;
  if (r.availabilityPct != null && r.availabilityTarget != null && r.availabilityPct < r.availabilityTarget)
    out.push({ severity: "high", code: "low_availability", message: `Availability ${fmt(r.availabilityPct)}% vs target ${fmt(r.availabilityTarget, 0)}%: out-of-stock stores don't show the product in search at all. Keep the serving warehouses stocked.` });
  if (r.storesClosed != null && r.storesLive != null && r.storesClosed > r.storesLive)
    out.push({ severity: "high", code: "stores_closed", message: `${r.storesClosed} dark stores closed vs ${r.storesLive} live: the listing is invisible to customers of the closed stores.` });
  const slow = r.unitsPerStoreDay != null && r.unitsTarget != null && r.unitsPerStoreDay < r.unitsTarget
    && (r.salesPerStoreDay == null || r.salesTarget == null || r.salesPerStoreDay < r.salesTarget);
  if (slow)
    out.push({ severity: "medium", code: "below_expansion_target", message: `Sells ${fmt(r.unitsPerStoreDay, 3)} units/store/day vs target ${fmt(r.unitsTarget, 3)}${assessmentOpen ? ` (assessment ends ${r.assessmentEnd!.toISOString().slice(0, 10)})` : ""}: risks losing stores at the next assessment.` });
  if (r.complaintPct != null && r.complaintTarget != null && r.complaintPct >= r.complaintTarget)
    out.push({ severity: "high", code: "complaints", message: `Complaints ${fmt(r.complaintPct)}% (limit ${fmt(r.complaintTarget, 0)}%): high complaint products get disabled.` });
  if (r.descriptionLength === 0)
    out.push({ severity: "medium", code: "no_description", message: "No description: add one with the words customers search for." });
  else if (r.descriptionLength < MIN_DESCRIPTION)
    out.push({ severity: "low", code: "short_description", message: `Description is only ${r.descriptionLength} characters; aim for ${MIN_DESCRIPTION}+ with key search terms and benefits.` });
  if (r.imageCount < MIN_IMAGES)
    out.push({ severity: "medium", code: "few_images", message: `${r.imageCount} product images; add up to ${MIN_IMAGES}+ (pack front/back, nutrition, usage, size).` });
  const mand = r.missing.filter((m) => m.mandatory);
  if (mand.length) out.push({ severity: "high", code: "missing_mandatory", message: `Mandatory attributes empty: ${mand.map((m) => m.name).join(", ")}.` });
  if (r.missing.length - mand.length > 0)
    out.push({ severity: "low", code: "missing_attributes", message: `${r.missing.length - mand.length} customer-facing attributes empty (filters and PDP details): ${r.missing.filter((m) => !m.mandatory).slice(0, 6).map((m) => m.name).join(", ")}${r.missing.length - mand.length > 6 ? "…" : ""}.` });
  if (r.units === 0) out.push({ severity: "medium", code: "no_sales", message: "No sales in the period." });
  if (r.expansionLevel && /trial|launch/i.test(r.expansionLevel))
    out.push({ severity: "low", code: "not_launched", message: `Expansion level ${r.expansionLevel}: limited store coverage until it qualifies.` });
  return out;
}

const RANK = { high: 0, medium: 1, low: 2 } as const;

export async function ingestListingSeo(ctx: SeoCtx, p: J): Promise<{ products: number; snapshotDate: string }> {
  const expansion = (p.expansion as J[]) ?? [];
  const products = (p.products as Record<string, J>) ?? {};
  const citiesBy = (p.cities as Record<string, J[]>) ?? {};
  const attrsByCat = (p.attributes as Record<string, J[]>) ?? {};
  const sales = new Map(((p.sales as J[]) ?? []).map((s) => [String(s.product_id), s]));
  const complaints = new Map(((p.complaints as J[]) ?? []).map((c) => [String(c.product_id ?? (c.detail as J)?.product_id), c]));
  const period = typeof p.period === "string" ? p.period : null;
  const snapshotDate = new Date(`${istToday()}T00:00:00.000Z`);
  let n = 0;

  for (const row of expansion) {
    const d = (row.detail ?? {}) as J, m = (row.metric ?? {}) as J, t = (row.metric_target ?? {}) as J;
    const loc = (row.locations ?? {}) as J, stores = (loc.darkstores ?? {}) as J, cities = (loc.cities ?? {}) as J;
    const pid = str(d.product_id);
    if (!pid) continue;
    const prod = products[pid] ?? {};
    const attrs = ((prod.attributes as J[]) ?? []);
    // Attributes match on id; key (internal name) / name (label) are fallbacks for older payloads.
    const byId = new Map(attrs.map((a) => [str(a.id), a.value]));
    const byName = new Map(attrs.flatMap((a) => [[str(a.key).toLowerCase(), a.value], [str(a.name).toLowerCase(), a.value]] as [string, unknown][]));
    const primary = ((prod.categories as J[]) ?? []).find((c) => c.is_primary);
    const catAttrs = primary ? (attrsByCat[str(primary.id)] ?? []) : [];
    const missing = catAttrs.filter((a) => !filled(byId.get(str(a.id)) ?? byName.get(str(a.name).toLowerCase())))
      .map((a) => ({ name: str(a.name), group: a.group ?? null, mandatory: !!a.mandatory }));
    const description = str(byName.get("description") || prod.description).trim();
    const images = ((prod.sliding_images as J[]) ?? []).map((i) => str(i.image_path)).filter(Boolean);
    const title = str(prod.name || d.product_name);
    const s = sales.get(pid);
    const c = complaints.get(pid);
    const period_ = (row.assessment_period ?? {}) as J;
    const assessmentEnd = period_.end_date ? new Date(str(period_.end_date)) : null;

    const v = {
      itemId: d.item_id != null ? str(d.item_id) : null, name: title, brandName: str(prod.brand) || null,
      category: primary ? str(primary.name) : str(d.business_category_name) || null, unit: str(d.unit || prod.unit) || null,
      expansionLevel: str(d.expansion_level) || null,
      availabilityPct: num(m.availability), availabilityTarget: num(t.availability),
      unitsPerStoreDay: num(m.cpd), unitsTarget: num(t.cpd), salesPerStoreDay: num(m.gmv), salesTarget: num(t.gmv),
      complaintPct: num(m.complaint),
      storesLive: int(stores.live), storesNew: int(stores.new), storesClosed: int(stores.closed),
      citiesLive: int(cities.live), citiesNew: int(cities.new), citiesClosed: int(cities.closed),
      assessmentEnd: assessmentEnd && !Number.isNaN(assessmentEnd.getTime()) ? assessmentEnd : null,
      periodLabel: period, units: s ? int(s.units_sales) ?? 0 : 0, sales: s ? num(s.sales_amount) ?? 0 : 0,
      salesSharePct: s ? num(s.sales_contribution_in_percentage) : null,
      complaints: c ? int(c.complaints ?? c.total_complaints ?? c.complaint_count) : int(m.total_complaint),
      titleLength: title.length, descriptionLength: description.length, imageCount: images.length,
      attrsFilled: catAttrs.length - missing.length, attrsTotal: catAttrs.length,
      engagementScore: num(byName.get("product_engagement_score") ?? byName.get("product engagement score")),
    };
    const issues = listingIssues({ ...v, complaintTarget: num(t.complaint), missing })
      .sort((a, b) => RANK[a.severity] - RANK[b.severity]);
    const json = {
      missingAttributes: missing as Prisma.InputJsonValue,
      cities: (citiesBy[pid] ?? []).map((ct) => {
        const cm = (ct.metric ?? {}) as J, cs = (ct.darkstores ?? {}) as J;
        return { city: ct.city_name, state: ct.state_name, status: ct.status, live: int(cs.live), new: int(cs.new), closed: int(cs.closed),
          unitsPerStoreDay: num(cm.cpd), salesPerStoreDay: num(cm.gmv), complaintPct: num(cm.complaint), availabilityPct: num(cm.availability) };
      }) as Prisma.InputJsonValue,
      content: {
        title, description, hindiName: str(byName.get("product_name_hin") ?? byName.get("product name in hindi")) || null, images: images.slice(0, 10),
        attributes: attrs.filter((a) => a.type === "shown_to_customer" && filled(a.value)).map((a) => ({ name: a.name, value: str(a.value).slice(0, 300) })),
        tags: prod.tags ?? [], state: prod.current_state ?? null,
      } as Prisma.InputJsonValue,
      issues: issues as unknown as Prisma.InputJsonValue,
    };
    await prisma.listingSeoSnapshot.upsert({
      where: { brandId_platformId_snapshotDate_productId: { brandId: ctx.brandId, platformId: ctx.platformId, snapshotDate, productId: pid } },
      create: { ...ctx, snapshotDate, productId: pid, ...v, ...json },
      update: { ...v, ...json },
    });
    n++;
  }
  return { products: n, snapshotDate: snapshotDate.toISOString().slice(0, 10) };
}
