// Idempotent seed: platforms, cities, subscription plans.
// Roles & permissions are defined in code (lib/rbac/permissions.ts), not seeded.
// No production admin credentials are hardcoded here.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PLATFORMS = [
  { slug: "blinkit", name: "Blinkit", brandColor: "#eda100" },
  { slug: "zepto", name: "Zepto", brandColor: "#6250d6" },
  { slug: "instamart", name: "Instamart", brandColor: "#eb6834" },
  { slug: "bigbasket", name: "BigBasket", brandColor: "#1baf7a" },
  // Ad account connector (brands.blinkit.com); not a sales channel in analytics filters.
  { slug: "blinkit-ads", name: "Blinkit Ads", brandColor: "#f8cb46" },
];

const CITIES = [
  { name: "Delhi NCR", region: "North" },
  { name: "Mumbai", region: "West" },
  { name: "Bengaluru", region: "South" },
  { name: "Hyderabad", region: "South" },
  { name: "Pune", region: "West" },
  { name: "Chennai", region: "South" },
];

const PLANS = [
  { code: "trial", name: "Free Trial", priceMonthly: 0, priceYearly: 0, limits: { brands: 1, skus: 50, seats: 2 } },
  { code: "starter", name: "Starter", priceMonthly: 4999, priceYearly: 49990, limits: { brands: 2, skus: 500, seats: 5 } },
  { code: "growth", name: "Growth", priceMonthly: 14999, priceYearly: 149990, limits: { brands: 10, skus: 5000, seats: 20 } },
  { code: "scale", name: "Scale", priceMonthly: 39999, priceYearly: 399990, limits: { brands: 100, skus: 50000, seats: 100 } },
];

async function main() {
  for (const p of PLATFORMS) {
    await prisma.platform.upsert({ where: { slug: p.slug }, create: p, update: { name: p.name, brandColor: p.brandColor } });
  }
  // City has no natural unique key in the schema; upsert by name via findFirst.
  for (const c of CITIES) {
    const found = await prisma.city.findFirst({ where: { name: c.name } });
    if (!found) await prisma.city.create({ data: c });
  }
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      create: plan,
      update: { name: plan.name, priceMonthly: plan.priceMonthly, priceYearly: plan.priceYearly, limits: plan.limits },
    });
  }
  console.log(`Seeded ${PLATFORMS.length} platforms, ${CITIES.length} cities, ${PLANS.length} plans.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
