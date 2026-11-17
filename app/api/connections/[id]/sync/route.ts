import { prisma } from "@/lib/db"; import { handler,ok,NotFound } from "@/lib/http"; import { requireSession,assertCsrf } from "@/lib/auth/session"; import { requirePermission } from "@/lib/rbac/authorize"; import { writeAudit } from "@/lib/audit"; import { browserSupported } from "@/lib/connections/browser"; import { runBrowserSync } from "@/lib/connections/sync"; import { queuesEnabled } from "@/lib/queue/connection"; import { scheduledQueue } from "@/lib/queue/queues"; import { BadRequest } from "@/lib/http";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export const POST=handler(async(req,ctx:{params:{id:string}})=>{const session=await requireSession(req);assertCsrf(req);let id:bigint;try{id=BigInt(ctx.params.id)}catch{throw NotFound("Connection not found")}const c=await prisma.platformConnection.findUnique({where:{id},include:{platform:true}});if(!c)throw NotFound("Connection not found");await requirePermission(session,c.orgId,"integration:create");
if(browserSupported(c.platform.slug)){
  if(c.status!=="CONNECTED")throw BadRequest(`Connect ${c.platform.name} first`);
  // Optional { ranges: [...] } retries specific sales ranges (e.g. a month that failed).
  const body=await req.json().catch(()=>({}));const ranges=Array.isArray(body?.ranges)?body.ranges.filter((r:unknown)=>typeof r==="string"&&/^[A-Za-z0-9 ]{3,30}$/.test(r)).slice(0,12):undefined;
  const trigger=ranges?.length?"retry" as const:"manual" as const;
  if(queuesEnabled()){await scheduledQueue().add("connection-sync",{connectionId:id.toString(),trigger,...(ranges?.length?{ranges}:{})},{attempts:1});}
  else{await runBrowserSync(id,trigger,ranges?.length?{ranges,catalog:false}:{});}
  await writeAudit({userId:session.userId,orgId:c.orgId,action:"connection.sync_requested",target:id.toString()});
  return ok({queued:true,supported:true,message:`${c.platform.name} sync started`});
}
const message=`Manual sync blocked: ${c.platform.name} has no authorized live connector`;const job=await prisma.syncJob.create({data:{orgId:c.orgId,platformId:c.platformId,jobType:"manual_sync",status:"FAILED",startedAt:new Date(),finishedAt:new Date(),error:message}});await prisma.platformConnection.update({where:{id},data:{status:"ERROR",lastError:message}});await writeAudit({userId:session.userId,orgId:c.orgId,action:"connection.sync_blocked",target:id.toString(),meta:{syncJobId:job.id.toString()}});return ok({syncJobId:job.id,status:job.status,supported:false,message})});
