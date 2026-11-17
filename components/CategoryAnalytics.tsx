import { Download } from "lucide-react";
import { Card } from "./Card";
import type { CategoryRow, Comparison, Params } from "@/lib/client/analytics";
import { exportUrl } from "@/lib/client/analytics";
const METRIC_LABEL:Record<string,string>={gmv:"GMV",units:"Units sold",availabilityPct:"Availability %",oosPct:"Stock-out %",sovPct:"Share of voice %"};
const show=(v:number|null,suffix="")=>v==null?"—":new Intl.NumberFormat("en-IN",{maximumFractionDigits:1}).format(v)+suffix;
export function CategoryAnalytics({rows,comparison,params}:{rows:CategoryRow[];comparison:Comparison|null;params:Params}){
 return <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[1.5fr_1fr]">
  <Card title="Category analytics" subtitle="Missing observations are shown as —, never zero." right={<div className="flex gap-2"><a className="inline-flex items-center gap-1 text-xs" href={exportUrl(params,"csv")}><Download size={13}/>CSV</a><a className="inline-flex items-center gap-1 text-xs" href={exportUrl(params,"xlsx")}><Download size={13}/>Excel</a></div>}>
   <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[680px] text-xs"><thead><tr>{["Category","GMV","Units","Availability","OOS","Avg price","SOV"].map(h=><th key={h} className="border-b px-2 py-2 text-left" style={{borderColor:"var(--border)",color:"var(--muted)"}}>{h}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.category}><td className="border-b px-2 py-2 font-medium" style={{borderColor:"var(--border)"}}>{r.category}</td><td className="border-b px-2 py-2" style={{borderColor:"var(--border)"}}>₹{show(r.gmv)}</td><td className="border-b px-2 py-2" style={{borderColor:"var(--border)"}}>{show(r.units)}</td><td className="border-b px-2 py-2" style={{borderColor:"var(--border)"}}>{show(r.availabilityPct,"%")}</td><td className="border-b px-2 py-2" style={{borderColor:"var(--border)"}}>{show(r.oosPct,"%")}</td><td className="border-b px-2 py-2" style={{borderColor:"var(--border)"}}>₹{show(r.avgSellingPrice)}</td><td className="border-b px-2 py-2" style={{borderColor:"var(--border)"}}>{show(r.sovPct,"%")}</td></tr>)}{!rows.length&&<tr><td colSpan={7} className="py-8 text-center" style={{color:"var(--muted)"}}>No category observations in this period.</td></tr>}</tbody></table></div>
  </Card>
  <Card title="Previous-period comparison" subtitle={comparison?`${comparison.previousRange.from} to ${comparison.previousRange.to}`:"Loading…"}>
   <div className="mt-3 space-y-2">{comparison&&Object.entries(comparison.metrics).map(([key,m])=><div key={key} className="flex items-center justify-between rounded-lg px-3 py-2" style={{background:"var(--surface-2)"}}><span className="text-xs">{METRIC_LABEL[key]??key}</span><span className="text-right text-xs"><b>{show(m.current)}</b><span className="ml-2" style={{color:m.absoluteChange==null?"var(--muted)":m.absoluteChange>=0?"var(--good)":"var(--crit)"}}>{m.percentChange==null?"—":`${m.percentChange>=0?"+":""}${m.percentChange}%`}</span></span></div>)}</div>
  </Card>
 </div>
}
