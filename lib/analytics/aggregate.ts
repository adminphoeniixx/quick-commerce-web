// Aggregation: roll up listing-level facts into AnalyticsDaily at grain
// org × brand × platform × date. Unions sales and availability so a platform/date
// with only one kind of data still produces a row.
//
// Idempotent: recomputes the brand's rows from scratch in a transaction.
//
// Formulas (per brand × platform × date):
//   gmv          = SUM(DailyMetric.gmv)
//   units        = SUM(DailyMetric.unitsSold)
//   avgSellPrice = gmv / units                    (null when units = 0)
//   availabilityPct = AVG(AvailabilitySnapshot.availabilityPct) over listing×city
//   oosPct       = 100 * (# OOS observations) / (# observations)
// SOV is left null until visibility data is ingested.
import { prisma } from "@/lib/db";

interface SalesG { platformId: number; date: Date; gmv: string; units: number; }
interface AvailG { platformId: number; date: Date; avail: number | null; oos: number | null; }
interface VisG { platformId: number; date: Date; sov: number | null; }

const key = (platformId: number, date: Date) => `${platformId}|${date.toISOString().slice(0, 10)}`;

export async function aggregateBrand(orgId: bigint, brandId: bigint): Promise<number> {
  const [sales, avail, vis] = await Promise.all([
    prisma.$queryRaw<SalesG[]>`
      SELECT pl."platformId" AS "platformId", dm."metricDate" AS date,
             SUM(dm.gmv)::text AS gmv, SUM(dm."unitsSold")::int AS units
      FROM "DailyMetric" dm
      JOIN "PlatformListing" pl ON pl.id = dm."listingId"
      JOIN "Sku" s ON s.id = pl."skuId"
      WHERE s."brandId" = ${brandId}
      GROUP BY pl."platformId", dm."metricDate"`,
    prisma.$queryRaw<AvailG[]>`
      SELECT pl."platformId" AS "platformId", a."snapshotDate" AS date,
             AVG(a."availabilityPct")::float AS avail,
             (100.0 * SUM(CASE WHEN a."isOos" THEN 1 ELSE 0 END) / COUNT(*))::float AS oos
      FROM "AvailabilitySnapshot" a
      JOIN "PlatformListing" pl ON pl.id = a."listingId"
      JOIN "Sku" s ON s.id = pl."skuId"
      WHERE s."brandId" = ${brandId}
      GROUP BY pl."platformId", a."snapshotDate"`,
    prisma.$queryRaw<VisG[]>`
      SELECT "platformId" AS "platformId", "snapshotDate" AS date,
             (100.0 * SUM(CASE WHEN "isOwn" THEN 1 ELSE 0 END) / COUNT(*))::float AS sov
      FROM "VisibilityObservation"
      WHERE "brandId" = ${brandId}
      GROUP BY "platformId", "snapshotDate"`,
  ]);

  const rows = new Map<string, {
    platformId: number; date: Date; gmv: number; units: number;
    availabilityPct: number | null; oosPct: number | null; sovPct: number | null;
  }>();

  const blank = (platformId: number, date: Date) => ({
    platformId, date, gmv: 0, units: 0, availabilityPct: null as number | null, oosPct: null as number | null, sovPct: null as number | null,
  });
  const r2 = (v: number | null) => (v != null ? Math.round(v * 100) / 100 : null);

  for (const s of sales) {
    const e = rows.get(key(s.platformId, s.date)) ?? blank(s.platformId, s.date);
    e.gmv = Number(s.gmv); e.units = Number(s.units);
    rows.set(key(s.platformId, s.date), e);
  }
  for (const a of avail) {
    const e = rows.get(key(a.platformId, a.date)) ?? blank(a.platformId, a.date);
    e.availabilityPct = r2(a.avail); e.oosPct = r2(a.oos);
    rows.set(key(a.platformId, a.date), e);
  }
  for (const v of vis) {
    const e = rows.get(key(v.platformId, v.date)) ?? blank(v.platformId, v.date);
    e.sovPct = r2(v.sov);
    rows.set(key(v.platformId, v.date), e);
  }

  const data = [...rows.values()].map((r) => ({
    orgId, brandId, platformId: r.platformId, date: r.date,
    gmv: r.gmv, units: r.units,
    avgSellPrice: r.units > 0 ? Math.round((r.gmv / r.units) * 100) / 100 : null,
    availabilityPct: r.availabilityPct, oosPct: r.oosPct, sovPct: r.sovPct,
  }));

  await prisma.$transaction([
    prisma.analyticsDaily.deleteMany({ where: { orgId, brandId } }),
    ...(data.length ? [prisma.analyticsDaily.createMany({ data })] : []),
  ]);
  return data.length;
}
