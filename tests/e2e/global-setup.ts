import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/lib/auth/password";

export default async function setup() {
  const url = process.env.E2E_DATABASE_URL!;
  if (!/(test|e2e)/i.test(url)) throw new Error("Refusing to prepare a database not named test/e2e");
  process.env.DATABASE_URL = url;
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env: process.env });
  const db = new PrismaClient();
  const email = "e2e-owner@example.test";
  const previous = await db.user.findUnique({ where: { email }, include: { memberships: true } });
  if (previous) { await db.organization.deleteMany({ where: { memberships: { some: { userId: previous.id } } } }); await db.user.delete({ where: { id: previous.id } }); }
  for (const p of [{slug:"blinkit",name:"Blinkit"},{slug:"zepto",name:"Zepto"},{slug:"instamart",name:"Instamart"},{slug:"bigbasket",name:"BigBasket"}]) await db.platform.upsert({where:{slug:p.slug},create:p,update:{name:p.name}});
  const user = await db.user.create({ data: { email, fullName: "E2E Owner", passwordHash: await hashPassword("E2e-password-123!"), emailVerified: true } });
  for (const suffix of ["A", "B"]) { const org=await db.organization.create({data:{name:`E2E Organization ${suffix}`}}); await db.membership.create({data:{userId:user.id,orgId:org.id,role:"OWNER"}}); const brand=await db.brand.create({data:{orgId:org.id,name:`E2E Brand ${suffix}`,category:"Snacks"}}); await db.sku.create({data:{brandId:brand.id,name:"E2E Chips",skuCode:`E2E-${suffix}`,category:"Snacks"}}); }
  await db.$disconnect();
}
