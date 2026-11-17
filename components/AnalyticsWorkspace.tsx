"use client";
import { useEffect, useState } from "react";
import { ChannelTabs } from "@/components/ChannelTabs";
import { CityBars } from "@/components/CityBars";
import { OosChart } from "@/components/OosChart";
import { PricingTable } from "@/components/PricingTable";
import { SovDonut } from "@/components/SovDonut";
import { KeywordTable } from "@/components/KeywordTable";
import { getAvailability, getKeywords, getPricing, getSov, type CityAvail, type KeywordRow, type OosPoint, type PriceRow, type SovData } from "@/lib/client/analytics";
import type { Channel } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";

type View = "availability"|"pricing"|"visibility"|"keywords";
const COPY:Record<View,{title:string;description:string}>={
  availability:{title:"Availability analytics",description:"Observed stock coverage by city. Missing observations are not treated as out of stock."},
  pricing:{title:"Pricing analytics",description:"Observed selling price, MRP and discounts from persisted records."},
  visibility:{title:"Share of Visibility",description:"Observation-based presence with transparent keyword coverage."},
  keywords:{title:"Keyword intelligence",description:"Observed organic and sponsored ranking performance."},
};
export function AnalyticsWorkspace({view}:{view:View}){
 const[channel,setChannel]=useState<Channel>("ALL"),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const[city,setCity]=useState<CityAvail[]>([]),[oos,setOos]=useState<OosPoint[]>([]),[prices,setPrices]=useState<PriceRow[]>([]),[sov,setSov]=useState<SovData|null>(null),[keywords,setKeywords]=useState<KeywordRow[]>([]);
 useEffect(()=>{setLoading(true);setError("");const to=new Date(),from=new Date(to.getTime()-29*86400000);const p={platform:channel,from:from.toISOString().slice(0,10),to:to.toISOString().slice(0,10)};const task=view==="availability"?getAvailability(p).then(x=>{setCity(x.byCity);setOos(x.oosTrend)}):view==="pricing"?getPricing(p).then(setPrices):view==="visibility"?getSov(p).then(setSov):getKeywords(p).then(setKeywords);task.catch(e=>setError(e?.message||"Unable to load analytics")).finally(()=>setLoading(false))},[channel,view]);
 return <div><PageHeader title={COPY[view].title} subtitle={COPY[view].description}/><div className="mb-6"><ChannelTabs value={channel} onChange={setChannel}/></div>{error&&<div className="rounded-lg p-3 text-sm" style={{background:"color-mix(in srgb,var(--crit) 12%,transparent)",color:"var(--crit)"}}>{error}</div>}{loading?<div className="py-16 text-center text-sm" style={{color:"var(--muted)"}}>Loading persisted analytics…</div>:view==="availability"?<div className="grid gap-3 lg:grid-cols-2"><CityBars rows={city}/><OosChart rows={oos}/></div>:view==="pricing"?<PricingTable rows={prices}/>:view==="visibility"?<div className="max-w-xl"><SovDonut data={sov}/></div>:<KeywordTable rows={keywords}/>}</div>
}
