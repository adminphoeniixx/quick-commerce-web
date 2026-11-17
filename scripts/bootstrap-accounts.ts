import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth/password";
import { passwordSchema } from "../lib/validation";

const prisma = new PrismaClient();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function upsertUser(input: {
  email: string;
  fullName: string;
  password: string;
  isSuperAdmin: boolean;
}) {
  const email = input.email.toLowerCase();
  const password = passwordSchema.parse(input.password);
  const passwordHash = await hashPassword(password);

  return prisma.user.upsert({
    where: { email },
    create: {
      email,
      fullName: input.fullName,
      passwordHash,
      emailVerified: true,
      isSuperAdmin: input.isSuperAdmin,
    },
    update: {
      fullName: input.fullName,
      passwordHash,
      emailVerified: true,
      isSuperAdmin: input.isSuperAdmin,
    },
  });
}

async function main() {
  const admin = await upsertUser({
    email: required("BOOTSTRAP_ADMIN_EMAIL"),
    fullName: process.env.BOOTSTRAP_ADMIN_NAME?.trim() || "Platform Admin",
    password: required("BOOTSTRAP_ADMIN_PASSWORD"),
    isSuperAdmin: true,
  });

  const seller = await upsertUser({
    email: required("BOOTSTRAP_SELLER_EMAIL"),
    fullName: process.env.BOOTSTRAP_SELLER_NAME?.trim() || "Demo Seller",
    password: required("BOOTSTRAP_SELLER_PASSWORD"),
    isSuperAdmin: false,
  });

  const organizationName = process.env.BOOTSTRAP_SELLER_ORG?.trim() || "Demo Seller Organization";
  const existingMembership = await prisma.membership.findFirst({ where: { userId: seller.id, role: "OWNER" } });
  const organization = existingMembership
    ? await prisma.organization.update({ where: { id: existingMembership.orgId }, data: { name: organizationName } })
    : await prisma.organization.create({
        data: {
          name: organizationName,
          memberships: { create: { userId: seller.id, role: "OWNER" } },
        },
      });

  console.log(`Admin account ready: ${admin.email}`);
  console.log(`Seller account ready: ${seller.email} (organization ${organization.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
