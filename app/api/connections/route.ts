import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, BadRequest, Conflict, parseBody } from "@/lib/http";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { requirePermission, resolveOrgId } from "@/lib/rbac/authorize";
import { requireVerifiedEmail } from "@/lib/auth/verified";
import { encryptSecret } from "@/lib/crypto/secrets";
import { writeAudit } from "@/lib/audit";
import { browserSupported } from "@/lib/connections/browser";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
const platforms = ["blinkit", "blinkit-ads", "zepto", "instamart", "bigbasket"] as const;
const schema = z.object({ brandId: z.string().regex(/^\d+$/), platformSlug: z.enum(platforms), credential: z.string().min(1).max(8192).optional() });

export const GET = handler(async (req) => {
  const session = await requireSession(req); const orgId = resolveOrgId(session);
  await requirePermission(session, orgId, "integration:read");
  const [connections, history] = await Promise.all([
    prisma.platformConnection.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, select: { id:true,brandId:true,platformId:true,status:true,lastVerifiedAt:true,lastError:true,createdAt:true,encryptedSecret:true,brand:{select:{name:true}},platform:{select:{name:true,slug:true}}, } }),
    prisma.syncJob.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return ok({ connections: connections.map(({encryptedSecret,...c})=>({...c,hasCredential:Boolean(encryptedSecret),supported:browserSupported(c.platform.slug)})), history });
});

export const POST = handler(async (req) => {
  const session=await requireSession(req); assertCsrf(req); await requireVerifiedEmail(session); const orgId=resolveOrgId(session);
  await requirePermission(session,orgId,"integration:create"); const b=await parseBody(req,schema); const brandId=BigInt(b.brandId);
  const [brand,platform]=await Promise.all([prisma.brand.findFirst({where:{id:brandId,orgId}}),prisma.platform.findUnique({where:{slug:b.platformSlug}})]);
  if(!brand||!platform) throw BadRequest("Invalid brand or platform");
  const existing=await prisma.platformConnection.findUnique({where:{brandId_platformId:{brandId,platformId:platform.id}}}); if(existing) throw Conflict("A connection already exists for this brand and platform");
  let encryptedSecret:string|undefined; if(b.credential){try{encryptedSecret=encryptSecret(b.credential)}catch{throw BadRequest("Connector encryption is not configured")}}
  const browser=browserSupported(b.platformSlug);const connection=await prisma.platformConnection.create({data:{orgId,brandId,platformId:platform.id,encryptedSecret,status:"DISCONNECTED",lastError:browser?null:"Live API connector is not available for this platform"}});
  await writeAudit({userId:session.userId,orgId,action:"connection.created",target:connection.id.toString(),meta:{platform:b.platformSlug,brandId:b.brandId}});
  return ok({id:connection.id,status:connection.status,supported:browser},{status:201});
});
