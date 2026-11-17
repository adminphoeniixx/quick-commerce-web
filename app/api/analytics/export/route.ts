import ExcelJS from "exceljs";
import { handler, BadRequest } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { analyticsFilter } from "@/lib/analytics/params";
import { categoryAnalytics } from "@/lib/analytics/queries";
export const runtime="nodejs"; export const dynamic="force-dynamic";
const safe=(v:unknown)=>{const s=v==null?"":String(v);return /^[=+\-@\t\r]/.test(s)?`'${s}`:s};
const columns=["category","gmv","units","availabilityPct","oosPct","avgSellingPrice","sovPct"] as const;
export const GET=handler(async req=>{
 const session=await requireSession(req);const filter=await analyticsFilter(req,session);const format=new URL(req.url).searchParams.get("format")||"csv";if(!["csv","xlsx"].includes(format))throw BadRequest("format must be csv or xlsx");
 const rows=(await categoryAnalytics(filter)).map(row=>Object.fromEntries(columns.map(k=>[k,safe(row[k])])));const stamp=new Date().toISOString().slice(0,10);
 if(format==="xlsx"){
  const workbook=new ExcelJS.Workbook();workbook.creator="Quick Commerce Pulse";workbook.created=new Date();const sheet=workbook.addWorksheet("Category analytics");
  sheet.columns=columns.map(key=>({header:key,key,width:20}));for(const row of rows)sheet.addRow(row);sheet.getRow(1).font={bold:true};sheet.views=[{state:"frozen",ySplit:1}];
  const bytes=await workbook.xlsx.writeBuffer();return new Response(Buffer.from(bytes),{headers:{"content-type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","content-disposition":`attachment; filename="category-analytics-${stamp}.xlsx"`,"cache-control":"private, no-store","x-export-progress":"100"}})
 }
 const quote=(v:unknown)=>`"${safe(v).replace(/"/g,'""')}"`;const csv=[columns.map(quote).join(","),...rows.map(r=>columns.map(k=>quote(r[k])).join(","))].join("\r\n");return new Response(csv,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="category-analytics-${stamp}.csv"`,"cache-control":"private, no-store","x-export-progress":"100"}})
});
